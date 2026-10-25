Read this when publishing or consuming an event, or sending a remote command or query.

## Copy it or ask for it

A service that needs another service's data either keeps a copy fed by events, or asks the owner when it needs it. The choice follows the data:

| The data | Style | Why |
|---|---|---|
| Changes rarely, and the service must work when the owner is down (a product's name and price, for ordering) | Copy, fed by events | no runtime dependency |
| Changes with every operation (free stock) | Ask over RabbitMQ (request and reply query) | a copy would be behind exactly when it matters |
| Read rarely, and copying it would duplicate a whole service (the notices of an order) | Ask | not worth a copy |

- A remote query has its own short reply timeout and never fails the page: without an answer, the page shows the value as unknown.
- Only messages annotated `@CqrsMessage` in the contracts module are bound to the brokers. Every other query stays local.
- Kafka carries events only (`cqrs.kafka.commands.enabled=false`, `cqrs.kafka.queries.enabled=false`). Commands and queries between services go over RabbitMQ, request and reply.

## The outbox: events leave in the transaction of the change

- The repository adapter records the events the root pulled, in the caller's transaction, after the flush of the change (see `persistence-and-flyway`): the data, its events and their announcements commit together or not at all.
- Nothing sends to a broker inside a handler or an adapter call. A relay reads the pending rows afterwards and publishes them.
- With spring-boot-cqrs: `cqrs.outbox.enabled=true`; the events published through `OutboxEventBus` land in `cqrs_outbox` in the current transaction (it throws when there is none) and the relay publishes them through the event bus named in `cqrs.outbox.relay.event-bus`. The domain events themselves can be stored beside them in an event store the project provides.
- The relay locks rows with `FOR UPDATE SKIP LOCKED`, so replicas never publish the same row twice. With one relaying instance, order is insertion order; with several, batches are not ordered against each other.
- A broker outage delays events and never loses them. Delivery is at least once: if the process dies after the broker confirmed and before the relay committed, the event is published again. This is why consumers are idempotent.
- With RabbitMQ as the target, turn on publisher confirms, or rows are marked published too early.
- Lower the Kafka producer timeouts of the relaying app: the batch transaction and its locks stay open while a send blocks.
- An event class that cannot be read after a rename blocks its row. Annotate outbox events with `@CqrsMessage` and list their packages, and ship new event classes one release before publishing them.

**Without an outbox**, the one allowed shape is: an outbound adapter listens after the commit (`@TransactionalEventListener(phase = AFTER_COMMIT)` or equivalent), translates, and publishes. Say in your report that an event is lost if the process dies between the commit and the publish, and that the outbox would remove that window. Do not build the outbox inside a feature task.

## Two kinds of events, one translator

- The domain event stays inside the context. The integration event is a public contract: JDK types only, versioned (`ProductPublishedV1` or a `v1` in its schema name), in the contracts module.
- One outbound adapter implements the project's translator: `switch` over the sealed family, one integration event per domain event, or none when nobody outside cares.

```java
return List.of(switch (productEvent) {
  case ProductPublished published -> new contracts.ProductPublished(published.id().value(), ...);
  case ProductPriceChanged changed -> new contracts.ProductPriceChanged(...);
  case ProductDiscontinued discontinued -> new contracts.ProductDiscontinued(...);
});
```

- A domain event stored under a name (`product-published.v1`) never changes its name: a new shape gets a new version.
- Contract schemas: JSON Schema, closed with `additionalProperties: false`, `v<N>` in the file name. A breaking change is a new version, with both published for a while.
- The contracts module depends on nothing of Spring or Jackson, so services on different Boot generations can share it.

## Consuming events

```java
@EventHandler
public class OrderViewProjector {
  static final String CONSUMER = "orders.order-view";

  @HandleEvent
  @Idempotent(name = CONSUMER)
  public void on(OrderConfirmed event) { ... }
}
```

- Give `@Idempotent` an explicit stable `name`: the default is bean and method, and renaming either replays the messages still in the retention window.
- The JDBC store writes the marker in the handler's transaction, so the marker and the handler's database work commit together. If the handler fails, neither is stored and the redelivery runs it again.
- Never `REQUIRES_NEW` on an idempotent handler. An effect outside the database (an email, an API call) is not rolled back with the marker: make it idempotent on the remote side, or move it after the commit.
- Queries are not deduplicated, and `@Idempotent` on a `@HandleQuery` fails at startup.

### Order is per event type, not per aggregate

Kafka keeps order within a partition, and events share a topic keyed by name, so a cancellation can arrive before the order it cancels. Write the projection so any order converges:

- **As-of timestamps.** For each group of attributes, keep the `occurredOn` of the event that set it and ignore older ones. A late `ProductPublished` neither undoes a newer price nor re-lists a discontinued product.
- **Monotonic status.** Create the row from whichever event arrives first; the status only moves forward.
- **Optimistic locking on the projection row** (a version column): two consumers cannot overwrite each other, and the loser is redelivered on fresh data.
- **Waiting for the owner:** data for an entity not seen yet is stored without its owner and attached when its creation event arrives.

## Remote commands over RabbitMQ

- Request and reply: `RabbitMqCommandBus.dispatchAndReceive` behind an outbound port of the caller (`InventoryGateway`), implemented in `infrastructure.out.messaging`. The remote handler is the same `@HandleCommand` method; the library sends its return value back as the reply.
- A technical failure (timeout, a remote exception) is an exception the caller retries. A business "no" is a result record (`StockReservation(false, shortages)`): remote exceptions lose their type on the way back.
- The remote handler is idempotent by its business key (the order id): a repeated reservation answers the first outcome. Undo commands do nothing when there is nothing to undo.
- An undo that arrives first leaves a tombstone (a reservation already released), so the late forward command finds it and does nothing.
- An unknown reference (a product whose event has not arrived) is a retry, not a business "no".
- Remote calls run outside transactions: a call can last up to the reply timeout. Record the result afterwards in a short transaction, after checking that the state did not move.
- Retries back off exponentially, with a cap. Forward steps give up after a bound; compensations never give up.
- List the contract packages in `cqrs.rabbitmq.trusted-packages` (each subpackage, plus the JDK ones the replies use).

## Cancelling and compensating

A saga writes its row in the same transaction as the aggregate that starts it: there is no order without a saga and no saga without an order. A cancellation moves the saga to a compensating state in one transaction and is rejected with a clear 409 while the saga runs.
