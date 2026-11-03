# Use the console and optional LLM

## Inspect commands and bindings

Use `find <text>` to search commands and settings, and `help <name>` to read their
usage. Tab and Shift+Tab cycle completion and insert `/`. Up/Down recalls command
history; PageUp/PageDown scrolls output.

`bind mouse2` shows the right mouse button's command. `bindlist` lists current
bindings. The [controls menu](playing.md#change-controls) edits keys and mouse
buttons directly. Startup `config.cfg` and `autoexec.cfg` files in selected
content can also affect settings and bindings.

Ordinary console input uses the active world's behavior. To address one enabled
component, use:

```text
modcmd PRODUCT/COMPONENT_ID <command>
```

That component's commands, cvars, and `exec` scripts use its own source rules and
files. Disabling the component removes its pending commands and aliases.
See [component console commands](mod-compatibility.md#component-console-commands)
for declaration details.

## Configure the LLM

Open **Options → LLM options** and choose a provider:

| Provider | Setup |
| --- | --- |
| ChatGPT Subscription | Select **Sign in with ChatGPT** and complete browser sign-in. |
| ChatGPT API | Select **Paste API key**. |
| Other API | Enter a **Base URL** and select **Paste API key**. The service must support OpenAI-compatible Chat Completions. |

ChatGPT Subscription sign-in reuses a third-party client identity (the fixed
client ID, an `originator` of `pi` and a pinned `client_version`) and calls a
private ChatGPT backend endpoint. It can stop working without notice, and
whether that identity fits the provider's terms has not been assessed; use the
ChatGPT API provider where that matters.

Open **Model** to choose from the provider's paginated list. Choose a supported
**Reasoning effort** or **Model default**, then select **Save settings**.
**Refresh models** reloads the list; signing in or saving an API key loads it
automatically. A subscription may supply a recommended default. API model selection
is explicit.

## Ask for help or request commands

```text
llm_ask "How do I change mouse sensitivity?"
llm_exec "Set mouse sensitivity to 4"
llm_cancel
```

`llm_ask` prints an answer. `llm_exec` requests console commands, and `llm_cancel`
cancels the pending request in your console. Requests include available command
and setting documentation.

The complete returned batch is validated before any command runs. Structurally
invalid or unknown commands reject the batch, as do commands that run scripts,
change bindings, quit, connect or disconnect, change maps, send chat, write
files, or set a variable that the engine later runs as a command.
Nothing is sent to the provider until the first `llm_ask` or `llm_exec`. Accepted commands and their results
appear in the invoking player's console. Each command handler still validates
arguments and permissions. An execution error does not roll back commands that
already ran.

Only direct local console input can start LLM requests. Scripts, aliases, key
bindings, game modules, and server commands cannot trigger them. Closing the
session cancels pending requests. API usage can incur the selected provider's charges.

## Credential and preference files

These files live in the shared settings folder, `~/.local/share/quake-typescript/settings/`
(the `settings` folder next to the writable content root), for both the compiled executable
and a run from source. They are user settings, not game data, and are written with
mode `0600`. Back up, rotate or delete credentials there.

Releases before 1.1.1 kept them beside the executable. On the first start of a compiled
executable, any of these four files found beside it is copied into the settings folder
(an existing file there is never overwritten), restricted to mode `0600`, and then removed
from the old location; a `.legacy-migrated` marker is written so this happens once.
If the executable folder was read-only the old file stays where it was. Check there and
delete the file by hand if you no longer want it. Files in the working directory are never
imported.

| File | Contents |
| --- | --- |
| `chatgpt.key` | Independent API-key and subscription OAuth credentials, including refresh credentials. |
| `other.key` | The other provider's API key. |
| `other.service` | JSON with `baseUrl`, `model`, and `transport`. |
| `llm.json` | LLM preferences. |

