---
name: spring-hexagonal-ddd
description: Use when designing, implementing or reviewing a Spring Boot service with DDD and hexagonal architecture - aggregates, value objects, ports and adapters, domain and integration events, the outbox, RFC 9457 errors, ArchUnit - or service code that uses spring-boot-cqrs or spring-boot-specification-repository.
---

# Spring Boot services with DDD and hexagonal architecture

- These are fixed decisions for someone who already knows DDD; this skill does not teach it.
- Versions never come from memory: read them from `gradle/libs.versions.toml` and, for a doubtful API, from Context7.
- Skipping the letter of a rule is skipping the rule.

## Rules

1. `core-free` — `domain` and `application` import no framework: no `org.springframework`, `jakarta`, `org.hibernate`, Jackson (`com.fasterxml.jackson`, `tools.jackson`), `org.slf4j`, specification-repository or a platform support package. The only exception is the cqrs API: its handler annotations, buses and message types. Beans are built in `infrastructure.config`; time comes from an injected `Clock`.
2. `ports-and-layout` — the layout of `## Package layout`. The core reaches the outside only through `application.port.in` and `application.port.out`: interfaces, records and enums in the core's language, never shaped by a technology. The one other port is the repository, which lives in `domain`. Adapters translate and never decide: no business `if` in a controller, listener, job or query. Inbound and outbound adapters meet only through the core, and no adapter uses another.
3. `aggregates` — one root per consistency boundary, changed only through its behavior: no public setters, no public mutable fields. Value objects are records, valid at construction. Other aggregates are referenced by id. One transaction changes one aggregate. A factory checks every invariant and records the event; `reconstitute` does neither. The repository port lives in `domain` and saves whole roots.
4. `events-split` — domain events are records of a sealed family in `domain.event`, named in the past, carrying domain types. Integration events live in the contracts module: versioned (`…V1`, schemas `v<N>`) and free of framework types. One outbound adapter translates one into the other with an exhaustive `switch`. No other context sees a domain event, and the domain never sees a contract.
5. `outbox` — the repository adapter records the events the root pulled in the outbox (the event store) in the same transaction as the change, and a relay publishes them. No handler and no adapter sends to a broker inside the use case. Without an outbox, publish after the commit through one adapter, and report that an event is lost if the process dies between commit and publish.
6. `domain-exception` — every business failure, value-object validation included, is a `DomainException` subtype named `*Exception` with a stable kebab-case `code`: `NotFoundException` 404, `ConflictException` 409, `BusinessRuleViolationException` 422. The web adapter renders RFC 9457 problems with that `code`, and a new family gets its `ProblemMapper`. `IllegalArgumentException` and `IllegalStateException` never become a 4xx. A base without a `code` still gets named subtypes, each with its own problem title; report that it lacks the `code`.
7. `archunit` — ArchUnit guards rules 1 to 4 and the layout. Apply the project's shared rule set (for example `ShopArchitecture.all()`, and `unitTests()` on the test classes), or write the `ArchitectureTest` of `references/testing.md`. A new context, package or module gets its rules in the same change.
8. `specrepo-reads` — every read goes through specification-repository: `repository.query()…`, a `QueryPlan`, `@FilterableQuery` whitelists. No derived or `@Query` methods. Server conditions on a client plan go through `repository.query(plan).where(…)`. The core never sees the library: an outbound adapter implements the port over a `SpecificationRepository`.
9. `idempotent-consumers` — an event consumer is a `@HandleEvent` method with `@Idempotent(name = …)`, whose marker is written in the handler's transaction. It tolerates out-of-order delivery across event types: keep the `occurredOn` of the event that set each value and ignore older ones.
10. `business-no` — over a remote command (RabbitMQ request and reply), a business "no" is a result record, never an exception: an exception loses its type on the way back. The remote handler is idempotent by its business key.
11. `flyway-immutable` — never edit an applied migration: its checksum fails. A change is a new `V<n>`. A migration that reads another kit's tables is numbered after that kit's.

**When the project lacks what a rule names.** Check `gradle/libs.versions.toml` and the code first. Without spring-boot-cqrs, without specification-repository, without an outbox, without Flyway, or with a `DomainException` that has no `code`: follow the mechanism the project has (its use-case interfaces, its repositories, publishing after the commit through one adapter, its schema tool, its base exception), never add the library or build the outbox inside a feature task, and say once, in your report, which rule could not apply and why.

## Package layout

```text
<base package>.<service>
├── domain/                 aggregate root, value objects, the repository port
│   ├── event/              the sealed family of domain events (records)
│   └── exception/          DomainException subtypes (*Exception)
├── application/
│   ├── port/in/            commands, queries and the views they answer (or *UseCase interfaces)
│   ├── port/out/           what the use cases need: interfaces, records, enums
│   ├── service/            one handler (or *Service) per use case
│   └── exception/          failures the use cases raise (not found, duplicate)
└── infrastructure/
    ├── in/rest/v<N>/       controllers implementing the generated OpenAPI interfaces, REST mappers
    ├── in/messaging/       event consumers
    ├── out/persistence/    *Entity, Spring Data repositories, Jpa* adapters, mappers
    ├── out/messaging/      the integration-event translator, remote clients
    └── config/             the composition root
```

Gradle modules per ring only where the project already has them; otherwise packages and ArchUnit.

## When to read each reference

- Modeling an aggregate, a value object, a domain event or an exception: read `references/tactical-ddd.md` now, and again every time you get here: your memory of it does not survive compaction.
- Creating a service, a context, a package, a module or the composition root: read `references/hexagonal-layout.md` now, and again every time you get here: your memory of it does not survive compaction.
- Writing a command, a query, a handler, a read, a filter or a report: read `references/cqrs-and-specrepo.md` now, and again every time you get here: your memory of it does not survive compaction.
- Publishing or consuming an event, or sending a remote command or query: read `references/messaging-and-outbox.md` now, and again every time you get here: your memory of it does not survive compaction.
- Writing an entity, a mapper, a repository adapter or a migration: read `references/persistence-and-flyway.md` now, and again every time you get here: your memory of it does not survive compaction.
- Writing tests or ArchUnit rules, or choosing which suite to run: read `references/testing.md` now, and again every time you get here: your memory of it does not survive compaction.

## Red flags

Each thought below was seen breaking a rule. The rule wins.

| Thought | Rule |
|---|---|
| "The notification is sent after the commit, through the integration event. That way only what really was saved is confirmed." | `outbox`: after-commit alone loses the event if the process dies before publishing. Use the outbox, or publish through one adapter, and say once in your report that there is no outbox and what is lost. |
| "It translates the domain events into integration events and publishes them after the commit: the notification only goes out if the change was saved." | `outbox`, and the paragraph above: a missing outbox is reported, even in a hurry. |
| "These fields are value objects. Each one validates its own range at construction." | `domain-exception`: value-object validation is a business failure. Throw a named `DomainException` subtype, not `IllegalArgumentException`. |
| "A value object has rejected the input: a value out of range, a text too long, a malformed id." (answered with a generic 400) | `domain-exception`: a named subtype with its own title and a kebab-case `code`; if the base has no `code`, report it. |

## Before you report

- Tests are green.
- ArchUnit rules cover what is new.
- Every rule that could not apply is stated once.
