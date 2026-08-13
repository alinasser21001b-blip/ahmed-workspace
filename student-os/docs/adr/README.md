# Architecture Decision Records

Short records of decisions that were not obvious, so that a future reader (or a
future us) can tell the difference between a considered choice and an accident.

| ADR | Decision |
| --- | --- |
| [0001](0001-modular-monolith.md) | Modular monolith, not microservices |
| [0002](0002-content-spine.md) | One `content_items` spine instead of six content tables |
| [0003](0003-single-authorization-layer.md) | Exactly one authorization implementation, shared by API, search, files and AI |
| [0004](0004-sql-over-orm.md) | Hand-written SQL in repositories, not an ORM |
| [0005](0005-scrypt-password-hashing.md) | scrypt from Node's standard library for password hashing |
| [0006](0006-expo-universal-client.md) | Expo + Expo Router for iOS, Android and web from one codebase |
| [0007](0007-ranking-in-sql-with-parity-test.md) | Feed ranking in SQL, kept honest by a parity test against TypeScript |
| [0008](0008-trigram-search.md) | Trigram search rather than `tsvector`, because the corpus is bilingual |
| [0009](0009-arabic-normalisation.md) | Normalise Arabic for search — in the column and in the query, and only where it is meaning-preserving |
| [0010](0010-domain-events-outbox.md) | One domain-event vocabulary, delivered through a transactional outbox |
| [0011](0011-realtime-notifies-database-decides.md) | The realtime socket notifies; the database decides |
| [0012](0012-knowledge-type-as-a-second-axis.md) | Knowledge type is a second axis, not an extension of content kind |
| [0013](0013-provenance-classes.md) | Five provenance classes, and no invented confidence score |
| [0014](0014-learning-signals-are-not-analytics.md) | Learning signals are a separate channel from analytics, and AI is optional |
