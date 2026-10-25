Read this when preparing a release or touching publishing, the version, the changelog or the API baseline.

## Publishing

- Publishing to Maven Central goes through the vanniktech plugin, applied by `<prefix>-publish-conventions` (`cqrs-` or `specification-`), with the Central Portal token and the signing key as CI secrets.
- Publishing limits: Maven Central counts every uploaded file against its limits. Each module uploads its artifacts, their signatures and the md5/sha1 checksums of the artifacts. The convention removes the sha256/sha512 checksums and the checksums of the signatures before the upload; never put them back.

## The release

- `release.yml` is launched by hand. It publishes, and it commits `chore: bump version to <next>-SNAPSHOT`, which fires `snapshot.yml`. Its other steps are as `docs/cicd-workflow.md` tells them.
- `CHANGELOG.md` is written by git-cliff (`cliff.toml`, which skips `chore: bump version to`), never by hand. The version in `gradle.properties` is not edited by hand either.
- Before announcing a release, try it in a service that consumes it, with that service's composite build of local libraries.

## API baseline (japicmp)

Where the repository has it, `apiCompatibility` compares each published module with its artifact at `apiBaseline`, set in `gradle.properties`:

- Never empty `apiBaseline` to make the build pass.
- An incompatible change inside a major is marked `@API(status = INTERNAL)` or `EXPERIMENTAL` before it is released as stable, or it waits for the next major.
- After a major reaches Maven Central, the first commit after the release moves `apiBaseline`, once the artifacts resolve.
- A `release/X.Y.x` branch carries its own `apiBaseline`.
- A new module joins `apiCompatibility` after its first release, not before: until then there is no artifact to compare with.
