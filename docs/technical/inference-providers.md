# Inference providers

MatSci-SAM supports Ollama and a service compatible with the OpenAI chat
completion API. The latter uses OAuth client credentials. Server settings select
the deployment assistant and optional monitored alternate. Contributors can also
choose a separately configured, validated and enabled Wolfram Agent One profile
for ordinary definition requests. The admin **AI & services** page manages that
profile and reports deployment endpoint readiness. Credentials remain on the
server.

Use the operations repository for host setup, credential provisioning, protected
backups and recovery commands. Record release and provider checks in the private
environment record.

## Configure a provider

The deployment provider defaults to Ollama with model `gemma4:26b`.
`OLLAMA_HOST` selects its endpoint. Generation falls back to
`http://127.0.0.1:11434` when that variable is absent, but the readiness check
reports **Not configured** until `OLLAMA_HOST` is set explicitly.

| Setting | Meaning |
| --- | --- |
| `INFERENCE_PROVIDER` | `ollama` (default) or `openai-compatible` |
| `INFERENCE_PROFILE` | Public label recorded with generations. Defaults to the provider name |
| `INFERENCE_MODEL` | Exact requested model. Defaults to `gemma4:26b` for Ollama and is required for the compatible service |
| `OLLAMA_HOST` | Existing Ollama endpoint |
| `INFERENCE_BASE_URL` | HTTPS API base, including its version path. Compatible service only |
| `INFERENCE_TOKEN_URL` | HTTPS OAuth token endpoint. Compatible service only |
| `INFERENCE_CLIENT_ID` | Application registration identifier. Compatible service only |
| `INFERENCE_CLIENT_SECRET` | Protected application credential. Compatible service only |
| `INFERENCE_TIMEOUT_MS` | Total generation deadline, default 90000. Allowed 1000–300000 |
| `INFERENCE_MAX_TOKENS` | Output limit for the compatible service, default 2048. Allowed 64–32768 |

Use a profile such as `research-cluster` to distinguish deployments. Profile
names contain lowercase letters, digits, hyphens, or underscores and are at most
80 characters. Exclude account names and protected infrastructure details from
these public provenance labels. Model names must match the service catalog.
Similar model names across services do not prove identical weights.

The compatible adapter requires `/models`, `/chat/completions`, bearer access
tokens, and `response_format` with a JSON schema. It does not send the client
secret as an API key. The token manager obtains and caches a token, uses its
returned lifetime, and refreshes shortly before expiry. Concurrent requests
share the refresh within a process. A 401 from the generation endpoint permits
one retry with a new token. A repeated failure is reported. A readiness check
that receives a 401 or 403 invalidates the cached token and reports an
authentication failure without retrying the check. Provisioned credentials
support unattended application requests.

Keep credentials in protected server settings. Exclude them from `NEXT_PUBLIC_*`
variables. Both endpoints that receive credentials require HTTPS, reject
credentials embedded in URLs and query parameters, and refuse redirects. Rotate
credentials through the management process for the service and update all app
processes using them. Application logs exclude token responses and raw invalid
model output.

## Check readiness and structured output

Administrators can open **AI & services → Service health** to inspect and
refresh readiness for both endpoints. **In use** identifies the endpoint
receiving application requests. **Alternate** is monitored separately.
Application routing changes require an explicit provider switch. Each shows its
profile, provider, requested model, status, and check time. An unconfigured
alternate is labeled **Not configured**. Its absence or failure does not change
the health of the active endpoint.

**Inference testing** opens an editable prompt panel at `/admin/inference`.
Choose **Short answer** for an `answer` field or **Definition and example** for
the definition system prompt in SAM with `definition` and `example` fields. Both
exercise the same structured generation transport as the application and require
nonempty strings.

Each explicit test reports the submitted prompt, validated output, elapsed time,
profile, provider, and requested/returned model identity. A passed test confirms
response format, not factual quality. Errors distinguish invalid output from
configuration, authentication, or service failures. The panel uses the provider
selected on the server. It does not change that selection or accept endpoint
URLs or credentials from the browser.

Prompts are limited to 4,000 characters. Tests use the configured request
timeout and token limit for the compatible service, with no automatic UI retry.
Results remain in the page for inspection. The diagnostic creates no terms,
definitions, suggestions, study responses, or graph updates. The configured
inference provider receives the test prompt.

Run the terminal diagnostics with these commands.

```bash
pnpm inference:check
pnpm inference:check --live
```

The first command checks configuration, authentication, and model availability.
The `--live` command makes at most six sequential requests using synthetic
materials science input and the prompts and schemas in SAM. It covers public
drafts for new terms and revisions, legacy definition/example generation, and
pilot position/comment/answer output. It writes no application records. The
output reports validation, elapsed time, and generation metadata without
credentials or response bodies from the model.

The live diagnostic tests schema support in addition to model availability. SAM
validates responses locally with Zod. Unsupported schema modes, truncated
answers, refusals and invalid JSON are rejected before publication.

## Switching and provenance

### Monitor an alternate endpoint

In the protected server environment file, configure the alternate with the same
settings as an active provider, replacing `INFERENCE_` with
`INFERENCE_ALTERNATE_`. For an Ollama alternate, its host setting is
`INFERENCE_ALTERNATE_OLLAMA_HOST`. The alternate must specify its provider and
all required connection settings. It inherits no active endpoint settings. The
model defaults for each provider and validation rules still apply.

Stage a compatible endpoint for monitoring while Ollama remains in use.

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
with independent deadlines. The compatible endpoint exchanges credentials for a
token and lists models. Ollama is asked for model details. Neither check
generates text. The admin response excludes credentials, endpoint URLs and raw
service errors. Readiness is measured from the application server, so the
alternate must be reachable and authorized from that server.

### Change the endpoint in use

Application releases and provider selection are separate operations. Select a
provider through the protected provider settings. Verify the selection in the
health panel in the running application after its restart.

Set the provider, profile, and model together, retaining the settings for the
previous provider. Restart the application after changing its environment. To
promote the alternate, copy its settings into the active settings and put the
previous active settings into the alternate group if continued monitoring is
desired. The environment file controls routing. The admin page displays the
selection. `INFERENCE_ALTERNATE_PROVIDER` configures monitoring only. To return
to Ollama, set `INFERENCE_PROVIDER=ollama`, set an appropriate profile, and set
`INFERENCE_MODEL=gemma4:26b` or remove the model override. Retain the original
`OLLAMA_HOST`. Leaving a cluster model override in place would ask Ollama for
that different model name.

Provider changes apply to subsequent requests. Saved study responses and
attribution for earlier contributions remain unchanged. Database migrations are
separate deployment operations.

A request snapshots its configuration before network I/O. Its result includes
validated output and metadata for the provider that returned the output. The
metadata records provider, profile, requested model, a configuration hash, and
the returned model identity when supplied. The hash covers endpoint and
generation options, excluding credentials. It is an audit fingerprint, not a
digest of model weights. Keep the corresponding configuration in the private
operational record if later reproduction is needed.

Public suggestions persist generation metadata before preview. Publication
copies that metadata to the definition and initial revision, retaining the
original generator through provider switches. Human edits clear generation
metadata on the new revision. Historical revisions retain theirs. JSON and RDF
provenance include provider information where recorded. Existing rows have null
metadata. The migration does not infer a historical provider or rewrite model
identities.

There is no automatic fallback between providers. Contributors can continue
writing manually after a failed request. Provider failures and invalid model
output remain distinct. Callers control transport retries, and the compatible
adapter only handles the bounded token retry internally.

## Pilot runs

A pilot snapshots one configuration for its run and records it in the local
manifest. Resuming requires the same configuration hash. Changing the provider,
model, endpoint, or generation options requires a new rehearsal suffix.
Automatic resume also requires a configuration record in the manifest. Start a
new rehearsal for older manifests that lack one.

Credentials may rotate without changing the public configuration hash. They must
still be valid at runtime. The contributor picker applies to ordinary definition
requests. Pilot runs and study requests retain the deployment configuration.
Studies have no saved provider override.

## Contributor assistant choice and Wolfram Agent One

The `default` profile for the definition assistant uses the deployment
`INFERENCE_*` and `OLLAMA_HOST` settings. The visible label identifies the
configured model. The separate `agent-one` profile uses the fixed Wolfram
endpoint `https://services.wolfram.com/api/agent-one/v1/chat/completions` and a
dedicated `WOLFRAM_AGENT_ONE_API_KEY` stored on the server. Factual reference
lookups use the separate `WOLFRAM_API_KEY`. The optional
`WOLFRAM_AGENT_ONE_TIMEOUT_MS` defaults to 90 seconds and is bounded to 1–300
seconds. No endpoint supplied by a client, model tag, or credential is accepted.

After configuring the dedicated key, an administrator must run the definition
validation test in **AI & services** and explicitly enable Agent One. Validation
is tied to the adapter configuration and credential using a private stored
digest. Rotating the key or changing its request configuration invalidates
readiness. The digest and credentials remain private to the server and are
excluded from generation provenance. A failed retest removes readiness. The
administrative sandbox for free text is separate and does not grant readiness.

Administrators set the default assistant. Contributors can select an available
assistant per request and save their preference. Explicit and saved choices are
validated on the server. An unavailable selection produces an actionable error,
with no automatic call to another provider. Configuration is snapshotted before
asynchronous request work. The resulting suggestion retains its generating
service even if defaults or preferences later change. Study revision requests
retain the existing deployment assistant, and Agent One suggestions cannot be
published into study steps.

Agent One accepts user/assistant messages and authorization with a raw API key.
SAM sends plain text instructions for the provider followed by the contributor's
exact user message. Those same instructions are stored in generation provenance.
The final answer from Agent One becomes the editable suggestion. SAM preserves
the text, Markdown and source links for contributor review. These links remain
part of the answer and are separate from retrieved reference receipts and
contributor citations.

Only a complete leading `<think>…</think>` block and surrounding whitespace are
removed. Empty answers, incomplete reasoning blocks, explicit refusals,
truncated responses, and answers longer than 10,000 characters are rejected. SAM
decodes the HTTP JSON envelope to extract the final assistant message and
permitted provenance metadata. The response body is bounded to 1 MiB, redirects
are refused, and provider errors omit response bodies. No unsupported
`response_format` or underlying model name is sent. Other inference providers
use structured output. Wolfram reference lookup uses a separate adapter. The
legacy administrator sandbox uses the Agent One transport for plain text.

Generation attribution identifies the producing service as `wolfram-agent-one`
(Wolfram Agent One), with no asserted underlying LLM identity. The returned
service model label, response UUID and bounded tool identity/request identifiers
are retained when supplied. Thought text, tool arguments and full tool output
are not retained in inference metadata. These identities supplement the exact
contributor input and definition output already retained with the suggestion.

Migration `0060_definition_assistants.sql` added the singleton assistant policy
and each contributor's nullable preferred profile. Existing users and
deployments retain the `default` profile without enabling Agent One.
`scripts/test-agent-one.ts` checks the adapter with controlled responses. It
makes no provider request or database write.

`scripts/test-agent-one-db.ts` exercises database and router authorization,
readiness, preference routing, exact input/provenance, study restrictions, key
rotation and ordering of overlapping validation tests with controlled responses.
It requires explicit `ALLOW_ASSISTANT_POLICY_TEST=true`. Run it against an
isolated local test database after migrations, with exclusive control of the
assistant policy. The script temporarily replaces the singleton settings row,
then restores its original contents or absence and deletes its fixtures. Do not
run concurrent administrator settings changes or application requests against
that temporary policy. The test commits temporary policy changes and cleans them
up afterward. Check the restoration readback before reusing the database. It
does not establish live Agent One readiness.

Protocol reference
[Wolfram Agent One API](https://www.wolfram.com/apis/documentation/cag/wolfram-agent-one-api/).
