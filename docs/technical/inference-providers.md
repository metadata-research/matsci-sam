# Inference providers

MatSci-SAM supports Ollama and an OpenAI-compatible chat-completion service
that uses OAuth client credentials. Server settings choose the deployment
assistant and optional monitored alternate. Contributors can also choose a
separately configured, validated and enabled Wolfram Agent One profile for
ordinary definition requests. The admin **AI & services** page manages that
profile and reports deployment endpoint readiness; credentials remain on the
server.

This reference describes application behavior. Keep host-specific setup,
credential provisioning, protected backups, and recovery commands in the
deployment's operations repository. Record live release and provider checks
in its private environment record. Neither belongs in contributor-facing
documentation.

## Configure a provider

Existing installations need no new settings: `OLLAMA_HOST` still selects the
Ollama endpoint, and the default model remains `gemma4:26b`.

| Setting | Meaning |
| --- | --- |
| `INFERENCE_PROVIDER` | `ollama` (default) or `openai-compatible` |
| `INFERENCE_PROFILE` | Non-secret label recorded with generations; defaults to the provider name |
| `INFERENCE_MODEL` | Exact requested model; defaults to `gemma4:26b` for Ollama and is required for the compatible service |
| `OLLAMA_HOST` | Existing Ollama endpoint |
| `INFERENCE_BASE_URL` | HTTPS API base, including its version path; compatible service only |
| `INFERENCE_TOKEN_URL` | HTTPS OAuth token endpoint; compatible service only |
| `INFERENCE_CLIENT_ID` | Application registration identifier; compatible service only |
| `INFERENCE_CLIENT_SECRET` | Protected application credential; compatible service only |
| `INFERENCE_TIMEOUT_MS` | Total generation deadline, default 90000; allowed 1000–300000 |
| `INFERENCE_MAX_TOKENS` | Compatible-service output limit, default 2048; allowed 64–32768 |

Use a profile such as `research-cluster` to distinguish deployments. Profile
names contain lowercase letters, digits, hyphens, or underscores and are at
most 80 characters. They are public provenance labels, so use no account
names or protected infrastructure details. Model names must match the service's
catalog. Similar model names across services do not prove identical weights.

The compatible adapter requires `/models`, `/chat/completions`, bearer
access tokens, and `response_format` with a JSON schema. It does not send the
client secret as an API key. The token manager obtains and caches a token,
uses its returned lifetime, and refreshes shortly before expiry. Concurrent
requests share the refresh within a process. A model-endpoint 401 permits one
new-token retry; a repeated failure is reported. No SSH agent or browser login
is required by the application after its credentials are provisioned.

Keep credentials in protected server settings, never `NEXT_PUBLIC_*`
variables. Both credential-bearing endpoints require HTTPS, reject URL-embedded
credentials and query parameters, and refuse redirects. Rotate credentials
through the service's management process and update all app processes using
them. The application never prints token responses or raw invalid model output.

## Check readiness and structured output

Administrators can open **AI & services → Service health** to inspect and
refresh both endpoints' readiness. **In use** identifies the endpoint receiving
application requests; **Alternate** is checked separately and never receives
automatic failover traffic. Each shows its profile, provider, requested model,
status, and check time. An unconfigured alternate is labeled **Not configured**;
its absence or failure does not change the active endpoint's health.

**Inference testing** opens an editable
prompt panel at `/admin/inference`. Choose **Short answer** for an `answer`
field or **Definition and example** for the application's definition system
prompt with `definition` and `example` fields. Both exercise the same structured
generation transport as the application and require nonempty strings.

Each explicit test reports the submitted prompt, validated output, elapsed
time, profile, provider, and requested/returned model identity. A passed test
confirms response format, not factual quality. Errors distinguish invalid
output from configuration, authentication, or service failures. The panel uses
the server-selected provider; it does not change that selection or accept
endpoint URLs or credentials from the browser.

Prompts are limited to 4,000 characters. Tests use the configured request
timeout and compatible-service token limit, with no automatic UI retry. Results
remain in the page for inspection; the diagnostic creates no terms, definitions,
suggestions, study responses, or graph updates. The prompt is still sent to the
configured inference provider.

The terminal diagnostics remain available:

```bash
pnpm inference:check
pnpm inference:check --live
```

The first command checks configuration, authentication, and model availability.
The `--live` command additionally makes at most six sequential requests using
synthetic materials-science input and the application's prompts/schemas. It
covers public new-term/revision drafts, legacy definition/example generation,
and pilot position/comment/answer output. It writes no application records.
The output reports validation, elapsed time, and generation metadata without
credentials or model-response bodies.

These checks complement each other: a successful model listing does not prove
schema support, and a prose completion is not a structured-output test. An
unsupported schema mode, truncated answer, refusal, or invalid JSON must not
be published as a suggestion. Zod validation remains local to the app.

## Switching and provenance

### Monitor an alternate endpoint

In the protected server environment file, configure the alternate with the
same settings as an active provider, replacing `INFERENCE_` with
`INFERENCE_ALTERNATE_`. For an Ollama alternate, its host setting is
`INFERENCE_ALTERNATE_OLLAMA_HOST`. The alternate must specify its provider and
all required connection settings; it inherits no active endpoint settings.
The provider-specific model defaults and validation rules still apply.

For example, while Ollama is in use, stage a compatible endpoint for monitoring:

```dotenv
INFERENCE_ALTERNATE_PROVIDER=openai-compatible
INFERENCE_ALTERNATE_PROFILE=research-cluster
INFERENCE_ALTERNATE_MODEL=your-model-id
INFERENCE_ALTERNATE_BASE_URL=https://inference.example.org/v1
INFERENCE_ALTERNATE_TOKEN_URL=https://identity.example.org/token
INFERENCE_ALTERNATE_CLIENT_ID=your-application-client
INFERENCE_ALTERNATE_CLIENT_SECRET=your-protected-credential
```

Restart the application after editing the file. Health checks run in parallel
with independent deadlines. The compatible endpoint exchanges credentials for
a token and lists models; Ollama is asked for model details. Neither check
generates text. Credentials, endpoint URLs, and raw service errors are never
returned to the admin page. Readiness is measured from the application server,
so the alternate must be reachable and authorized from that server.

### Change the endpoint in use

Deploying application code and selecting an inference provider are separate
operations. A code update does not select the alternate unless the deployment
also changes the protected provider settings. Verify the selection in the
running application's health panel after its restart.

Set the provider, profile, and model together, retaining the settings for the
previous provider. Restart the application after changing its environment.
To promote the alternate, copy its settings into the active settings and put
the previous active settings into the alternate group if continued monitoring
is desired. The page cannot edit these settings. Merely changing
`INFERENCE_ALTERNATE_PROVIDER` does not change application routing.
To return to Ollama, set `INFERENCE_PROVIDER=ollama`, set an appropriate profile,
and set `INFERENCE_MODEL=gemma4:26b` or remove the model override. Retain the
original `OLLAMA_HOST`. Leaving a cluster model override in place would ask
Ollama for that different model name.

Changing provider settings affects subsequent requests. It does not migrate
or replace the database, alter saved study responses, or relabel earlier
contributions. Any database migration required by an application release is
a separate deployment operation.

A request snapshots its configuration before network I/O. Its result includes
validated output and metadata for the provider that actually answered. The
metadata records provider, profile, requested model, a configuration hash,
and the returned model identity when supplied. The hash covers endpoint and
generation options, excluding credentials; it is an audit fingerprint, not a
model-weight digest. Keep the corresponding configuration in the private
operational record if later reproduction is needed.

Public suggestions persist their generation metadata before preview and carry
it to the published definition and initial revision. Publishing after a switch
retains the original generator. Human edits clear generation metadata on the
new revision; historical revisions retain theirs. JSON and RDF provenance
include provider information where recorded. Existing rows have null metadata;
the migration does not infer a historical provider or rewrite model identities.

There is no automatic cross-provider fallback. A failed request leaves the
contribution workflow available without claiming another service produced it.
Provider failures and invalid model output remain distinct; callers control
transport retries, and the compatible adapter only handles the bounded token
retry internally.

## Pilot runs

A pilot snapshots one configuration for its run and records it in the local
manifest. Resuming requires the same configuration hash. Changing the provider,
model, endpoint, or generation options requires a new rehearsal suffix. Older
manifests without a configuration record also refuse automatic resume: their
inference setup cannot be established from the manifest alone.

Credentials may rotate without changing the public configuration hash; they
must still be valid at runtime. The contributor picker described below applies
to ordinary definition requests. Pilot runs and study requests retain the
deployment configuration; they have no saved per-study provider override.

## Contributor assistant choice and Wolfram Agent One

The `default` definition-assistant profile continues to use the deployment's
existing `INFERENCE_*` / `OLLAMA_HOST` settings. Its visible label comes from the
configured model, so an OAuth/FLAME deployment is never automatically labelled
Gemma. The separate `agent-one` profile uses Wolfram's documented fixed endpoint
`https://services.wolfram.com/api/agent-one/v1/chat/completions` and a dedicated
server-only `WOLFRAM_AGENT_ONE_API_KEY`. It never borrows `WOLFRAM_API_KEY`, which
continues to belong to factual reference lookups. The optional
`WOLFRAM_AGENT_ONE_TIMEOUT_MS` defaults to 90 seconds and is bounded to 1–300
seconds. No client-supplied endpoint, model tag, or credential is accepted.

After configuring the dedicated key, an administrator must run the definition
validation test in **AI & services** and explicitly enable Agent One. Validation
is tied to the adapter configuration and credential using a private stored
digest; rotating the key or changing its request configuration invalidates
readiness. The digest and credentials are never returned to the browser or
included in generation provenance. A failed retest removes readiness. The
administrative free-text sandbox is separate and does not grant readiness.

Administrators set the default assistant. Contributors can select an available
assistant per request and save their preference. Explicit and saved choices are
validated on the server; an unavailable selection produces an actionable error,
with no automatic call to another provider. Configuration is snapshotted before
asynchronous request work. The resulting suggestion retains its generating
service even if defaults or preferences later change. Study revision requests
retain the existing deployment assistant, and Agent One suggestions cannot be
published into study steps.

Agent One accepts user/assistant messages and raw API-key authorization. SAM
sends provider-specific plain-text instructions followed by the contributor's
exact user message. Those same instructions are stored in generation provenance.
Agent One's final answer becomes the editable suggestion directly: SAM does not
request or parse a JSON definition, recover a JSON fragment, strip citation
footers, or call another model to rewrite the answer. Markdown and source links
remain part of that answer for the contributor to review. They do not become
independently retrieved reference receipts or automatically attached citations.

Only a complete leading `<think>…</think>` block and surrounding whitespace are
removed. Empty answers, incomplete reasoning blocks, explicit refusals, truncated
responses, and answers longer than 10,000 characters are rejected. The HTTP JSON
envelope is still decoded to read the final assistant message and safe provenance
metadata. The response body is bounded to 1 MiB, redirects are refused, and
provider errors never expose response bodies. No unsupported `response_format`
or underlying model name is sent. Other inference providers retain their
structured-output contracts, and the separate Wolfram reference lookup is
unchanged. The legacy administrator sandbox uses the same plain-text transport.

Generation attribution identifies the producing service as `wolfram-agent-one`
(Wolfram Agent One), without guessing its underlying LLM. The returned service
model label, response UUID and bounded tool identity/request identifiers are
retained when supplied. Thought text, tool arguments and full tool output are
not retained in inference metadata. These identities supplement the exact
contributor input and definition output already retained with the suggestion.

Migration `0060_definition_assistants.sql` adds the singleton assistant policy
and each contributor's nullable preferred profile. Existing users and deployments
retain the `default` profile without enabling Agent One. `scripts/test-agent-one.ts`
checks the adapter with controlled responses; it makes no provider request or
database write.

`scripts/test-agent-one-db.ts` exercises actual database/router authorization,
readiness, preference routing, exact input/provenance, study restrictions, key
rotation and overlapping validation-test ordering with controlled responses.
It requires explicit `ALLOW_ASSISTANT_POLICY_TEST=true`. Run it only against an
intended local test database after migrations, with exclusive control of the
assistant policy: the script temporarily replaces the singleton settings row,
then restores its original contents (or absence) and deletes its own fixtures.
Do not run concurrent administrator settings changes or live application
requests against that temporary policy. This is not a transaction-only read
check or a live Agent One readiness test. Use the established process-tree
memory cap and check the restoration readback before resuming the preview.

Protocol reference: [Wolfram Agent One API](https://www.wolfram.com/apis/documentation/cag/wolfram-agent-one-api/).
