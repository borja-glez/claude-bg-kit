Read this when modeling an aggregate, a value object, a domain event or an exception.

The code is plain Java with no annotation: `domain` runs and is tested with `new`.

## When you add a value or an id

- A value with a rule is a record that checks it in the compact constructor. An invalid one cannot exist, so no layer repeats the check.
- Normalize in the constructor too (trim, upper-case, scale a `BigDecimal`), so `10` and `10.00` are equal.
- Every id is a typed record (`ProductId`, `SellerId`) over a `UUID` or a string, never a bare `UUID` or `String` in a signature. The compiler then refuses an `OrderId` where a `CustomerId` goes.
- The failure is a named business exception, not `IllegalArgumentException`:

```java
public record Sku(String value) {
  private static final Pattern FORMAT = Pattern.compile("[A-Z0-9-]{3,40}");

  public Sku {
    value = value == null ? "" : value.trim().toUpperCase(Locale.ROOT);
    if (!FORMAT.matcher(value).matches()) {
      throw new InvalidSkuException("SKU must be 3-40 characters from A-Z, 0-9 and '-'");
    }
  }
}
```

## Entity or value object

- It has an identity that outlives its attributes: entity, equal by id. Two orders with the same data are two orders.
- It is defined by its values: record. A line inside an aggregate is an entity when adding the same product again must grow that line.
- Equality of an entity is by id only. A record never carries an id it does not own.

## Sizing an aggregate (Vernon's four rules)

1. It protects true invariants: what must be consistent at once lives inside the root.
2. It is small. A seller does not contain its products, nor a customer its orders.
3. Other aggregates are referenced by id (`SellerId`, `CategoryId`), never by object.
4. One transaction changes one aggregate. Changing N of them is N transactions, each through its own use case; between aggregates and contexts the consistency is eventual, by events.

Concurrency is the aggregate's too: the stored form carries a version, and the domain knows nothing of it beyond carrying the number (see `persistence-and-flyway`).

## Rich model, not anemic

- State changes through verbs of the business (`publish`, `changePrice`, `discontinue`), never `setStatus`. The verb checks the lifecycle and records the event.
- A getter returns an unmodifiable view or an immutable value: `Collections.unmodifiableSet(tags)`, `List.copyOf(lines)`.
- A change that alters nothing returns without an event (`changePrice` to the same price).
- A transition the lifecycle forbids throws its own named exception.
- The aggregate takes the `Clock` as a parameter; it never calls `Instant.now()`.
- The persistence adapter reads the root through a `state()` snapshot record and rebuilds it with `reconstitute(state)`. No getter-per-column is needed for that.

## Creating is not reconstituting

```java
public static Product draft(ProductDraft draft, Clock clock) { /* checks every invariant, records the event if any */ }

public static Product reconstitute(ProductState state) { return new Product(state); }
```

- The constructor is private. The factory (`place`, `draft`) validates everything in a fixed order, so a request that breaks several rules always reports the same one, and records the creation event.
- `reconstitute` is for the repository: the thing already existed, so it validates nothing and records nothing.
- A factory that needs several sources or numbering rules becomes a class (`OrderFactory`); until then it is a static method of the root.
- Creation input as the user typed it (raw strings) goes in a record such as `ProductDraft`, which the factory validates.

## Domain events

```java
public sealed interface ProductEvent extends DomainEvent
    permits ProductPublished, ProductPriceChanged, ProductDiscontinued {}

public record ProductPublished(ProductId id, Sku sku, String name, Money price, SellerId seller, Instant occurredOn)
    implements ProductEvent {}
```

- A sealed family per aggregate, in `domain.event`, each event a record named in the past and carrying domain types and `occurredOn`.
- The root records the event (`record(...)`) and never publishes it: it knows no bus. After the save, `pullEvents()` hands them to the repository adapter.
- Sealing makes the translator's `switch` exhaustive: a new event that nobody decided about does not compile.
- An event is emitted only for what other contexts care about: a draft that is discontinued announces nothing.

## One repository per root

- The interface lives in `domain`, speaks only domain types (`Optional<Product> findById`, `void save(Product)`), and saves whole roots. It never returns an entity of persistence or a Spring `Page`.
- Extra methods answer questions the use case needs (`existsBySku`), not generic table access.
- Reads for screens go through a read model port in `application.port.out`, not through the repository (see `cqrs-and-specrepo`).

## Domain service or use case

- Business rule that looks at several aggregates, has no state and needs only a domain port: a domain service in `domain` (for example "a customer cannot hold more than N unpaid orders", over the repository port). It does not fit the root, because the root knows nothing of its siblings.
- Orchestration (load, ask the root, save, ask a port for outside data) with no business `if`: the use case in `application.service`.
- When you write an `if` about the business in a use case, it belongs in the root or in a domain service.

## Exceptions

`DomainException` is framework-free, carries a kebab-case `code` and knows no HTTP. The family:

| Base | HTTP | Use |
|---|---|---|
| `NotFoundException` | 404 | the thing does not exist, or must not be revealed (another seller's product, a draft) |
| `ConflictException` | 409 | clashes with current state (duplicate SKU, concurrent change) |
| `BusinessRuleViolationException` | 422 | a rule or lifecycle is broken (invalid SKU, product discontinued) |

- Each rule has its own subclass named for the rule and ending in `Exception`, with its fixed code: `InvalidSkuException` is `invalid-sku`.
- Failures raised by the domain live in `domain.exception`; those the use cases raise (not found, duplicate) in `application.exception`. Both extend `DomainException`.
- Which status each subtype gets is decided by the web adapter, not the domain.

## The state machine

The lifecycle (`DRAFT -> ACTIVE -> DISCONTINUED`) lives in the root. When transitions are many, put `canTransitionTo` on the status enum as an exhaustive `switch` with no `default`, so a new status forces a decision.
