Read this when writing tests or ArchUnit rules, or choosing which suite to run.

## Test a rule at the lowest layer that can show it

Each layer is cheaper and faster than the next. Test a rule at the lowest layer that can show it.

| Layer | Tooling | Covers | Spring | Docker |
|---|---|---|---|---|
| Domain | JUnit, AssertJ, `new` | roots, value objects, state machine; each business rule | no | no |
| Use cases | JUnit with fakes of the ports | orchestration: what is loaded, saved, raised | no | no |
| Architecture | ArchUnit | layers, framework-free core, layout, events, exceptions | no | no |
| Slices | `@WebMvcTest`, `@DataJpaTest` | HTTP to message, validation, problem details; repository and mapper against SQL | slice | for `*IT` |
| Integration | `@SpringBootTest` + Testcontainers | real buses, real SQL, real brokers; one service | yes | yes |
| Component | full context, the service alone | one journey through its API and messages | yes | yes |
| System | plain HTTP through the gateway | customer journeys, faults and stress, cross-service invariants | running platform | yes |

- Tests named `*IT` start Testcontainers and need a running Docker daemon. Say so when you cannot run them.
- Domain tests need no framework and run in milliseconds; each reads as the rule it checks (`aShippedOrderCannotBeCancelled`).
- Every rule that has a "no" is tested: a transition that must be refused, a value that must be rejected, a duplicate.

## Use-case tests with fakes

- A fake is the second implementation of a port (`InMemoryProductRepository`, a stub read model, a stub gateway that can be told to refuse). Put them in `application.fakes` of the test tree.
- The in-memory repository keeps copies and returns new roots, like a database: forgetting `save` fails the test.
- Assert the outcome (the stored state, the events saved, how many saves), not that a mock was called.
- A fixed `Clock` makes "31 minutes later" a one-line test.
- A business refusal from a gateway is a returned value; test that the use case leaves the aggregate unchanged.
- Test files for a handler are named `<Handler>Test`, one per use case.

## When a test needs Spring or real SQL

- A controller slice runs the controller alone with mocked buses and checks which message each request dispatches. If the contract is OpenAPI, check the controller against it.
- A test compares the filter whitelist with the one the contract lists.
- A persistence slice runs the repository adapter against real SQL: the optimistic version, the events recorded with the change, the migrations applied from empty.
- A messaging test redelivers an event twice and out of order and checks the projection converged and the idempotency marker held.
- A remote query/command test checks the short timeout, the business "no" as a value, and the idempotent repeat.

## When you guard the layout with ArchUnit

Two classes, because production and test classes are imported separately.

With a shared rule set in the project (for example `ShopArchitecture`):

```java
@AnalyzeClasses(packages = "<base package>.<service>", importOptions = ImportOption.DoNotIncludeTests.class)
class ArchitectureTest {
  @ArchTest static final ArchTests rules = ShopArchitecture.all();
}

@AnalyzeClasses(packages = "<base package>.<service>", importOptions = ImportOption.OnlyIncludeTests.class)
class UnitTestsArchitectureTest {
  @ArchTest static final ArchTests rules = ShopArchitecture.unitTests();
}
```

Add the cqrs rules of the library for a service (handlers do not depend on Spring, handler methods are in handler classes, messages do not depend on frameworks).

**Without a shared rule set**, write the `ArchitectureTest` with at least these rules, over `<base package>.<context>`:

| Rule | Checks |
|---|---|
| `core-free` | `noClasses()` in `..domain..` or `..application..` depending on `org.springframework..`, `jakarta..`, `org.hibernate..`, `com.fasterxml.jackson..`, `tools.jackson..`, `org.slf4j..`, `com.borjaglez.specrepository..` (allow the cqrs API in `application`) |
| inward dependencies | `domain` and `application` do not depend on `..infrastructure..`; `domain` depends on the JDK and the kernel only |
| adapters separate | `..infrastructure.in..` and `..infrastructure.out..` do not depend on each other |
| no field injection | no field annotated `@Autowired`, `@Inject`, `@Value`, `@Resource` or `@PersistenceContext` |
| layout | `@Entity` / `@Embeddable` only in `infrastructure.out.persistence`; `@Configuration` only in `infrastructure.config`; controllers only in `infrastructure.in.rest`; classes of `application.port.out` are interfaces, records or enums |
| `events-split` | domain events are records; their interfaces are sealed; the domain does not depend on the contracts package |
| aggregates | no public setter and no public non-final field in `..domain..`; `*Repository.save` in `domain` takes an aggregate root |
| exceptions | classes under `domain.exception` and `application.exception` extend `DomainException` and end in `Exception` |
| unit tests | in the test classes, no dependency on `org.springframework..` |

- Every rule `allowEmptyShould(true)` only where the layer may be absent; otherwise an empty import must fail, so a mistyped package cannot pass.
- A rule is shown to fail once: plant a violation, see the red, remove it.
- ArchUnit covers what the compiler does not: package against package inside a module. Where the project has Gradle modules per ring, the compiler already refuses a Spring import in `domain`.

## When the project gates coverage or mutation

Where the project turns them on, they are part of `build`:

- `jacocoMergedVerification` merges the line and branch coverage of the unit, integration and component suites and fails below the limit the project set. Code generated from the OpenAPI contracts is not measured.
- A PIT mutation gate runs over the unit suite of the domain kernel and the modules that opt in, with a threshold.
- A new class is tested before it is counted: do not exclude it to pass a gate.

## Which suite to run

| Moment | Run |
|---|---|
| Writing a rule of the domain | the one test class (`./gradlew test --tests "*ProductTest"`) |
| Writing a use case | its `*HandlerTest` |
| Before reporting | `./gradlew test`, which includes ArchUnit, then `./gradlew integrationTest` and `componentTest` if Docker is up |
| A change that touches the outbox, a consumer or a saga | the integration test of that path, plus a system scenario if the project has one |
| Release or merge | `./gradlew build` |

Run Gradle with `--no-daemon` by default and always in the foreground: a daemon or a background run outlives the session. Run a suite again with `--rerun` when Gradle says it is up to date and you changed nothing it tracks. Do not claim a Docker-dependent suite passed if Docker was not running.
