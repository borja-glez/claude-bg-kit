Read this when writing a command, a query, a handler, a read, a filter or a report.

Without spring-boot-cqrs or specification-repository in `gradle/libs.versions.toml`, do not add them: keep the project's use-case interfaces and repositories and apply the parts of this file that still make sense (one use case per class, no business `if` in a controller, reads separate from the aggregate).

## Controllers only dispatch

A controller injects `CommandBus` and `QueryBus` and translates HTTP into one message:

| Call | For |
|---|---|
| `commands.dispatchAndReceive(cmd)` | a command that answers a value (the id of what it created) |
| `commands.dispatchAndWait(cmd)` | a command with no answer |
| `queries.ask(query)` | a query |

```java
@Override
public ResponseEntity<Void> publishProduct(String seller, UUID id) {
  commands.dispatchAndWait(new PublishProductCommand(id, seller));
  return ResponseEntity.noContent().build();
}
```

- The controller holds no rule, no repository and no other adapter. Who the caller is (a `@CurrentUser` header) is read by the adapter and put in the message.
- A command or query is a class in `application.port.in` that extends the library's `Command` / `Query`, final, with getters, null-checked in the constructor. A view the query answers is a record in the same package.
- A message that crosses services is a different thing: it lives in the contracts module, annotated `@CqrsMessage`, with a no-arg constructor and no Spring or Jackson types (see `messaging-and-outbox`).

## One handler per use case

- `@CommandHandler(remote = false)` or `@QueryHandler(remote = false)` class in `application.service`; one `@HandleCommand` / `@HandleQuery` per message; constructor-injected ports and the `Clock`.
- Use-case shape: load the root through the repository port, call its verb, `save`. Outside data comes through an outbound port. No business `if`.
- A command handler changes one aggregate. When a rule needs several validations in order, keep the order fixed and say it in the Javadoc, so the same request always reports the same failure.
- A guard shared by handlers (ownership: "the product belongs to this seller") is a small package-private helper in `application.service`, and a stranger's product answers as not found, so its existence is not revealed.
- A handler that other services call remotely is idempotent by its business key (see `messaging-and-outbox`).

## Every read goes through specification-repository

- `repository.query()` with `where(field, Operators.X, value)` and a terminal: `findOne`, `findAll`, `findSlice`, `count`. A Spring Data repository extending the library's interface supplies `query()`.
- No derived methods (`findBySku`) and no `@Query`. An `existsBySku` of the domain port is `query().where("sku", EQUALS, v).count() > 0` in the adapter.
- `findSlice` on a table that only grows (no `COUNT(*)`); `findAll(Pageable)` where the screen shows "page X of Y".
- The core never sees the library. The write repository adapter and the read-model adapter both implement ports over a `SpecificationRepository`.
- Reads for screens are a read-model port in `application.port.out` that answers views (`ProductCard`, a `Page` of the kernel). They need not rebuild the aggregate: reading has no invariant to protect.

## A client filter

The client sends text: `filter=field:op:value`, `orFilter=a:op:v;b:op:v`, `sort=field,asc`. The shape:

1. The controller passes the text through as a small framework-free record (for example `ClientFilter` and `PageRequest`) inside the query. The core never holds a `QueryPlan`.
2. The read adapter parses it with the HTTP filter parser and the `specrepository.http.*` limits into a client plan, carrying a whitelist.
3. The library checks the client part of the plan against the whitelist before any SQL runs; a bad field, operator or value is a 400 `invalid-filter` through the problem mapper.

- **Whitelists are narrow and deny by default.** One class or annotation lists `filterableFields` and `sortableFields`. Private fields (a seller's email, the owner id) are in none.
- **Share a whitelist** between endpoints with one composed `@FilterableQuery` annotation (for example `@ProductFilter`), so the search and its facets accept exactly the same requests. The OpenAPI contract lists the same fields; a test compares the two.
- **Case and accents:** declare the text fields matched ignoring them.
- Cap the page size (`spring.data.web.pageable.max-page-size`), tighten `specrepository.http.*`, and index the columns the screens filter and sort by.
- Every read-model adapter method that runs a client plan has a short read-only timeout (`@Transactional(readOnly = true, timeout = 5)`).

## Conditions the server adds

Derive from the client plan with `repository.query(plan)`:

| On the derived query | Effect |
|---|---|
| `where(...)` | a server condition: ANDed with the client's, exempt from the whitelist, never widened by a client `orFilter`. Ownership (`customerId = user`), visibility (`status = ACTIVE`). |
| `sortedByDefault(sort)` | used only when the client sorts nothing; end with a tie-breaker (`id`) so pages never repeat or skip |
| `leftFetch(paths...)` | fetch joins |
| `select(...).selectInto(Type.class)` | read columns straight into a record |

```java
return views.query(plan)
    .where("customerId", Operators.EQUALS, customerId)
    .sortedByDefault(NEWEST_ORDERS)
    .findAll(pageable)
    .map(OrderViews::summary);
```

`?filter=customerId:eq:someone-else` stays a 400, since the field is not whitelisted.

## Reports: the client filters, the server groups

- Grouping, selections, aggregates and `having` are written in code, never taken from the request: `having` is server input and the HTTP syntax has none.
- Shape: `repository.query(clientPlan).where(serverCondition).groupBy(...).select(...).countAs(...).sumAs(...).having(...)`, read with `findRows()` or `findRow()` (the first row).
- The client decides which rows (its whitelisted filters); the server decides what is grouped and summed. A client `filter=quantity:gte:10` on a field that is not whitelisted stays a 400.
- A report's timeout is a little longer than a search's.

## When a facet drops the client's own filter

- A disjunctive facet drops the client's own filter on its field, so a shopper can pick several values. Use a helper of the project's own, such as `QueryPlans.without(plan, field)`, that rebuilds the client plan without the conditions on that field; it is for facets only and cannot widen anything else.
- Count with `countDistinctAs` per value, and `minAs` / `maxAs` with `findRow()` for a range.
- Facets share the search's whitelist, with no sort.
