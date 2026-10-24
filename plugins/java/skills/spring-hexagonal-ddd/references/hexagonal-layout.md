Read this when creating a service, a context, a package, a module or the composition root.

## How far to go: four levels

| Level | What it is | When |
|---|---|---|
| 0 | Classic layers: controller, service, Spring Data | A CRUD or supporting subdomain with no real rules |
| 1 | Ports only outward, for what is external and changes (gateway, another service) | A context that is almost one adapter |
| 2 | Framework-free core, beans from configuration, ArchUnit | The default for a context with business rules |
| 3 | Module boundaries enforced by the compiler, one Gradle module per ring | Only where the project already has them |

Go up a level only when the problem asks for it. The rules of `SKILL.md` assume level 2 for any context with rules; level 3 adds the compiler as a second guardian (a `@Service` in a domain module does not compile because Spring is not on its classpath).

## When you create a context

- One root package per context, `<base package>.<context>` for a service or a modular monolith. The tree is the one of `SKILL.md`.
- Contexts talk through published contracts and messages, never through each other's code. Sharing a tiny kernel (`Money`, `DomainEvent`, `AggregateRoot`, `DomainException`) is fine; sharing entities is not.
- A context that conforms to another's published language sees only its `contracts` package.
- Level 3 variant, modules per ring: `domain` depends on the kernel only; `application` on `domain` only; `contracts` on nothing; `infrastructure` on the others plus Spring. The `build.gradle.kts` dependencies are the rule, and ArchUnit covers what is inside one module.

## When you add an inbound port

The shape depends on what the project has (check `gradle/libs.versions.toml`).

**With spring-boot-cqrs.** `application.port.in` holds the commands, the queries and the views they answer (records). Each use case is a class in `application.service`: `@CommandHandler(remote = false)` or `@QueryHandler(remote = false)`, one `@HandleCommand` / `@HandleQuery` method per message, constructor-injected ports. Controllers see only the buses.

```java
@CommandHandler(remote = false)
public class PublishProductHandler {
  public PublishProductHandler(ProductRepository products, Clock clock) { ... }

  @HandleCommand
  public void handle(PublishProductCommand command) {
    Product product = OwnedProducts.find(products, command.getProductId(), command.getSellerId());
    product.publish(clock);
    products.save(product);
  }
}
```

**Without it.** One `*UseCase` interface of one method per use case in `application.port.in`, a `*Service` implementing it in `application.service`, and the transaction put around it in the composition root (below). The controller receives the interface and does not know what wraps it.

In both: no `@Service`, `@Transactional` or Jackson annotation in the core; the use case holds no business `if`.

## When you add an outbound port

- A port is what the use case needs, in the core's language: `StockLevels.of(skus)`, `PaymentGateway.charge(...)`, never `saveRow` or `sendToTopic`.
- Interfaces, plus records and enums for what they exchange. A concrete class in `application.port.out` is a violation.
- The repository port is the exception to the package: it lives in `domain`, next to its root.
- An external model gets an anti-corruption adapter in `infrastructure.out.<system>`: it translates, and the third-party types never cross it.
- Interfaces only where there is a boundary: a domain service or a mapper is a class.

## The composition root

All wiring is in `infrastructure.config`, in `@Configuration(proxyBeanMethods = false)` classes. The core is built with `new` or registered by the cqrs scan; Spring is welcome only in the adapters, which carry `@Component`, `@Repository` or `@RestController`.

```java
@Bean
JpaProductRepository productRepository(ProductJpaRepository products, DomainEventStore events) {
  return new JpaProductRepository(products, events);
}
```

- **A `@Bean` declares the adapter class it returns, not its port** (for example `CatalogConfiguration`). The AOT build of a native image generates proxies (the read-only transactions of an adapter) from the declared type; declared as the interface, the adapter loses them silently.
- **Time** is an injected `Clock` bean; tests replace it.
- **Transactions, with cqrs.** The bus opens one per command (`cqrs.transactions.enabled`) and adapters join it; queries get none (`cqrs.transactions.queries=none`) and the read side opens its own read-only ones.
- **Transactions, without it.** Wrap the use case where it is built, with the wrapper implementing the same port:

```java
@Bean
PlaceOrderUseCase placeOrder(OrderRepository orders, Clock clock, PlatformTransactionManager tm) {
  var service = new PlaceOrderService(orders, clock);
  var tx = new TransactionTemplate(tm);
  return command -> tx.execute(status -> service.place(command));
}
```

- `spring.jpa.open-in-view=false`, so a session never leaves the use case.
- Constructor injection only; no `@Autowired`, `@Value` or `@Resource` fields.

## Adapters

- Inbound REST: contract first. The OpenAPI file generates `rest.v<N>.api` and `.model`; the controller implements the generated interface and only maps HTTP to a message and the answer back. The URL carries the major version.
- Inbound messaging: a listener translates a contract message into a command and sends it; it holds no rule.
- A scheduled job or a listener reaches the same inbound port as the controller. The business rule lives once, in the root, and protects every path.
- Inbound and outbound adapters meet only through the core; no adapter uses another.
