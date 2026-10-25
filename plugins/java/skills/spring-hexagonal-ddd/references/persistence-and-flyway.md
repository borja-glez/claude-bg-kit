Read this when writing an entity, a mapper, a repository adapter or a migration.

## Two models: domain and persistence

- The domain root has no `jakarta.persistence` annotation. The JPA entity (`ProductEntity`), its embeddables and its Spring Data repository live in `infrastructure.out.persistence`, and the entity is package-private or at least never leaves that package. An `@Entity`, `@Embeddable` or `@MappedSuperclass` anywhere else is a violation (ArchUnit guards it).
- JPA's constraints (empty constructor, setters, proxies, `@Version`) stay in the entity. The domain keeps its invariants and its behavior.
- The cost is a mapper of a few dozen lines, written once: `ProductMapper.toState(entity)` and `toEntity(state, seller, categories)`. It maps a state snapshot, not the root, so the domain needs no getter per column. Instants are stored in UTC.
- The persistence model does not copy the domain's shape. A line that is an entity in the domain can be an `@ElementCollection` of values in the table.
- Another aggregate is a reference: store its id and use `getReferenceById`, never load it to write a foreign key.
- A supporting CRUD context may use its entity directly, and then it has no `domain` rules to protect either.

## When you write the repository adapter

```java
public class JpaProductRepository implements ProductRepository {

  @Override
  public Optional<Product> findById(ProductId id) {
    return products.query().where("id", Operators.EQUALS, id.value())
        .findOne().map(ProductMapper::toState).map(Product::reconstitute);
  }

  @Override
  public void save(Product product) {
    ProductState state = product.state();
    if (state.version() == null) {
      products.saveAndFlush(toEntity(state));
    } else {
      stored(state).update(toEntity(state));   // the stored row must still have the version it was read with
      products.flush();
    }
    List<ProductEvent> recorded = product.pullEvents();
    if (!recorded.isEmpty()) {
      events.record(STREAM_TYPE, state.id().value().toString(), recorded);
    }
  }
}
```

- It implements the port of `domain`, speaks domain types, and is built in the composition root by `new`, declared as its own class.
- **Flush before recording events.** The change is written at once, so a conflict with another transaction fails here, and only then are the events recorded. Otherwise events of a change that is about to fail would be stored.
- **Optimistic version.** The entity has `@Version`; the state carries the version it was read with. Saving over a newer version fails with an optimistic locking failure, which the web layer answers as 409 `concurrent-modification` and the client reloads and retries. Saving does not write the new version back into the root: to change it again, read it again.
- Save once per transaction, after the change a use case asked for.
- A save is whole-root. Do not expose `updateStatus` or a partial write.
- Reads are specification-repository (`cqrs-and-specrepo`). `query().where("sku", EQUALS, v).count() > 0` is the `existsBySku`.
- `spring.jpa.open-in-view=false`, and a batch fetch size for collections.

## When the unit tests need a repository

Write `InMemoryProductRepository` implementing the same port: it keeps copies of the state and hands out new roots (a change a use case forgot to save is lost, and the test notices), bumps a version on each save, and keeps the events saved. Details in `testing`.

## When you change the schema

- **Never edit an applied migration.** Flyway checksums fail. A change is a new `V<n>`, even for a typo in a seed row.
- One schema history per service. Name `V<n>__what_it_does.sql`, with the next number above the highest applied.
- Index the columns that screens filter and sort by, in the migration that introduces them.
- An extension a query needs (case and accent insensitive search needs `unaccent`) is created in a migration (`create extension if not exists`).
- Seed data goes in its own migration, so it can be told apart from the schema.

### When a kit shares the schema history

A shared kit (an event store, an outbox table) may bring migrations of its own in a second location with its own number series, in the same history:

```yaml
spring:
  flyway:
    locations: classpath:db/migration,classpath:db/kit
    out-of-order: true
```

- The kit's series starts high (`V1000`) and continues from there (`V1000_1`), so the two never collide.
- `out-of-order: true`, because a new service migration is numbered below the kit's and must still run.
- **A migration that reads or writes the kit's tables is numbered after the kit's**: `V1001` and up. On a fresh database it then runs after `V1000` created the table.
- A migration that hands rows to the outbox (publishing seed data to other services) is written once, after the kit's, and never edited.
- Register the migration resources for a native image: only resources named at build time are in it.
