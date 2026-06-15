window.COURSE_SECTIONS = window.COURSE_SECTIONS || [];
window.COURSE_SECTIONS.push({
  id: 'setup',
  title: '1. Setup & First Agent',
  topics: [
    {
      id: 'hello-world',
      title: 'Hello World Agent',
      content:
        '<h3>Installing Google ADK</h3>' +
        '<p>Google ADK (Agent Development Kit) is a Python framework for building AI agents powered by Gemini models. Installation is a single pip command:</p>' +
        '<pre><code>pip install google-adk</code></pre>' +
        '<p>You also need a <strong>Gemini API key</strong>. Get one at <a href="https://aistudio.google.com/apikey" target="_blank">aistudio.google.com/apikey</a> -- click "Create API key." The key starts with <code>AQ.</code> followed by a long string.</p>' +
        '<p>Set it as an environment variable before running any agent:</p>' +
        '<pre><code>export GOOGLE_API_KEY="AQ.your-key-here"</code></pre>' +
        '<p>Alternatively, create a <code>.env</code> file <strong>in the same directory where you run <code>adk web</code></strong> (not a parent directory -- ADK only reads <code>.env</code> from the current working directory):</p>' +
        '<pre><code>GOOGLE_API_KEY=AQ.your-key-here</code></pre>' +
        '<p><strong>Free tier warning:</strong> Google\'s free tier quota can be exhausted quickly or set to 0 for some models. If you see a <code>429 RESOURCE_EXHAUSTED</code> error with <code>limit: 0</code>, you need to enable billing on your GCP project at <a href="https://console.cloud.google.com/billing" target="_blank">console.cloud.google.com/billing</a>. Gemini Flash is very cheap (~$0.15/M input tokens).</p>' +
        '<p>If you are using Vertex AI instead of the Gemini API, set <code>GOOGLE_CLOUD_PROJECT</code> and <code>GOOGLE_CLOUD_LOCATION</code> instead, and authenticate via <code>gcloud auth application-default login</code>.</p>' +

        '<h3>Project Structure</h3>' +
        '<p>ADK uses a convention-over-configuration approach. Every agent is a directory with an <code>agent.py</code> file (ADK 2.1+). The directory name becomes the agent name, and ADK discovers the agent by looking for <code>root_agent</code> in <code>agent.py</code>.</p>' +
        '<pre><code>my_project/\n' +
        '  my_agent/\n' +
        '    agent.py      # Must define `root_agent`\n' +
        '</code></pre>' +
        '<p>The <code>agent.py</code> file must export a variable called <code>root_agent</code>. This is the entry point that ADK looks for when it loads your agent. If you use <code>agent.py</code> instead, ADK 2.1 will fail with "No root_agent found" -- it specifically searches for <code>agent.py</code> or <code>root_agent.yaml</code>.</p>' +

        '<h3>The Agent Class</h3>' +
        '<p>The core of ADK is the <code>Agent</code> class (technically <code>LlmAgent</code>, but aliased as <code>Agent</code>). It takes three primary parameters:</p>' +
        '<ul>' +
        '<li><strong>name</strong> -- A unique identifier for the agent. Used in logs, traces, and multi-agent routing. Must be a valid Python identifier (no spaces, no hyphens).</li>' +
        '<li><strong>model</strong> -- The Gemini model to use. Common values: <code>gemini-2.5-flash</code> (fast, cheap, recommended for learning), <code>gemini-2.5-pro</code> (powerful, more expensive). Note: older model names like <code>gemini-2.0-flash</code> have been retired and will return a 404 error.</li>' +
        '<li><strong>instruction</strong> -- The system prompt that shapes agent behavior. This is the most important parameter for controlling what your agent does.</li>' +
        '</ul>' +
        '<pre><code>from google.adk.agents import Agent\n\n' +
        'root_agent = Agent(\n' +
        '    name=\'greeting_agent\',\n' +
        '    model=\'gemini-2.5-flash\',\n' +
        '    instruction=\'You are a helpful greeting agent. When the user says hello, respond warmly and ask how you can help.\'\n' +
        ')</code></pre>' +

        '<h3>Running Your Agent</h3>' +
        '<p>ADK provides three CLI surfaces for running agents, each suited to different stages of development:</p>' +
        '<table>' +
        '<tr><th>Command</th><th>Purpose</th><th>When to Use</th></tr>' +
        '<tr><td><code>adk run my_agent</code></td><td>Terminal REPL</td><td>Quick testing, scripting, CI pipelines</td></tr>' +
        '<tr><td><code>adk web .</code></td><td>Browser dev UI</td><td>Development, debugging, inspecting events</td></tr>' +
        '<tr><td><code>adk api_server .</code></td><td>REST API server</td><td>Integration testing, production deployment</td></tr>' +
        '</table>' +
        '<p>The dot (<code>.</code>) in <code>adk web .</code> tells ADK to look for agent packages in the current directory. You can also specify an explicit path.</p>' +

        '<h3>Understanding the Event Stream</h3>' +
        '<p>Every interaction with an ADK agent produces a stream of <strong>Event</strong> objects. Each Event contains:</p>' +
        '<ul>' +
        '<li><strong>content</strong> -- The actual text or data the agent produced</li>' +
        '<li><strong>actions</strong> -- Side effects like state changes or tool calls</li>' +
        '<li><strong>author</strong> -- Which agent produced this event (matters in multi-agent setups)</li>' +
        '<li><strong>invocation_id</strong> -- Groups events that belong to the same turn</li>' +
        '</ul>' +
        '<p>Notice what is <em>not</em> in the Event: token counts, cost, or latency. These are available in the Trace tab (covered next topic) but are not part of the event stream itself. This is a design choice -- ADK treats observability as a separate concern from the agent protocol.</p>',

      summary: 'ADK agents are Python packages with an agent.py that exports root_agent. The Agent class takes name, model, and instruction. Three CLI surfaces (run, web, api_server) serve different development stages. Events carry content and actions but no cost data.',

      mentalModel: 'ADK is like Flask for agents -- you define the agent in code (like defining a Flask app), ADK provides the runtime (like Flask provides the HTTP server). The agent.py with root_agent is like app = Flask(__name__) -- it is the discovery mechanism.',

      mistakes: [
        'Forgetting to create agent.py -- ADK discovers agents by importing Python packages. A directory without agent.py is invisible to ADK.',
        'Using retired model names -- gemini-2.0-flash was retired and returns a 404 NOT_FOUND error. Use gemini-2.5-flash instead. Always check for current model names if you get a NOT_FOUND error.',
        'Putting .env in the wrong directory -- ADK only reads .env from the current working directory, not parent directories. If your .env is in ~/adk-lab/ but you run adk web from ~/adk-lab/adk_hello/, the key will not be found. Use export GOOGLE_API_KEY=... for reliability across all phases.',
        'Hitting free tier quota limits -- the free tier can have a limit of 0 requests for some models (429 RESOURCE_EXHAUSTED with limit: 0). Enable billing on your GCP project at console.cloud.google.com/billing. Gemini Flash costs ~$0.15/M input tokens.',
        'Naming the variable something other than root_agent -- ADK specifically looks for this name. Calling it agent or my_agent will not work.',
        'Using hyphens in agent names -- the name parameter must be a valid Python identifier. Use underscores instead (greeting_agent, not greeting-agent).'
      ],

      exercise:
        '<p><strong>Step 1: Create a workspace and virtualenv</strong></p>' +
        '<pre><code>mkdir -p ~/adk-lab\ncd ~/adk-lab\npython3 -m venv .venv\nsource .venv/bin/activate\npip install --upgrade pip\npip install google-adk</code></pre>' +

        '<p><strong>Step 2: Set your API key</strong></p>' +
        '<p>Get a key from <a href="https://aistudio.google.com/apikey" target="_blank">aistudio.google.com/apikey</a> (starts with <code>AQ.</code>). The most reliable approach is to export it directly:</p>' +
        '<pre><code>export GOOGLE_API_KEY="AQ.your-key-here"</code></pre>' +
        '<p><strong>Important:</strong> If you use a <code>.env</code> file instead, it must be in the directory where you run <code>adk web</code>, not a parent directory. The free tier quota may be 0 for some models -- if you see <code>429 RESOURCE_EXHAUSTED</code> with <code>limit: 0</code>, enable billing on your GCP project.</p>' +

        '<p><strong>Step 3: Create the project structure</strong></p>' +
        '<pre><code>mkdir -p adk_hello/greeting_agent</code></pre>' +

        '<p><strong>Step 4: Write the agent definition</strong></p>' +
        '<p>Create <code>adk_hello/greeting_agent/agent.py</code> with this content:</p>' +
        '<pre><code>from google.adk.agents import Agent\n\n' +
        'root_agent = Agent(\n' +
        '    name="greeting_agent",\n' +
        '    model="gemini-2.5-flash",\n' +
        '    instruction=(\n' +
        '        "You are a friendly greeting agent. "\n' +
        '        "When someone says hello, respond warmly and ask what topic they would like to explore. "\n' +
        '        "If they ask about ADK, give a brief overview of Google Agent Development Kit."\n' +
        '    ),\n' +
        ')</code></pre>' +
        '<p><strong>Note:</strong> Use <code>gemini-2.5-flash</code>, not <code>gemini-2.0-flash</code> -- the 2.0 models have been retired and return a 404 NOT_FOUND error.</p>' +

        '<p><strong>Step 5: Run with the web UI</strong></p>' +
        '<pre><code>cd adk_hello\nadk web .</code></pre>' +
        '<p>Open <a href="http://localhost:8000" target="_blank">http://localhost:8000</a> in your browser. Select "greeting_agent" from the agent dropdown. Send "Hello!" and observe the response. You should see the ADK web interface with a chat panel, event inspector, and trace view.</p>' +
        '<p>If you see authentication errors, make sure your <code>GOOGLE_API_KEY</code> is set in the current terminal session. If you see quota errors, enable billing on your GCP project.</p>' +

        '<p><strong>Step 6: Try the terminal REPL</strong></p>' +
        '<p>Stop the web server (Ctrl+C), then:</p>' +
        '<pre><code>adk run greeting_agent</code></pre>' +
        '<p>Type "Hello!" and observe the response. Type "exit" to quit.</p>' +

        '<p><strong>Step 7: Try the API server</strong></p>' +
        '<pre><code>adk api_server .</code></pre>' +
        '<p>In another terminal (with the same virtualenv activated), send a request:</p>' +
        '<pre><code>curl -X POST http://localhost:8000/run \\\n' +
        '  -H "Content-Type: application/json" \\\n' +
        '  -d \'{\n' +
        '    "app_name": "greeting_agent",\n' +
        '    "user_id": "test_user",\n' +
        '    "session_id": "test_session",\n' +
        '    "new_message": {\n' +
        '      "role": "user",\n' +
        '      "parts": [{"text": "Hello!"}]\n' +
        '    }\n' +
        '  }\'</code></pre>' +
        '<p>Examine the JSON response. Note the event structure -- each event has <code>content</code> and <code>actions</code> fields, but no token cost information at the event level.</p>',

      postEvidence: 'ADK\'s web UI now shows both per-event and per-session token summaries (prompt tokens, candidate tokens, thinking tokens, totals). This is better than expected -- cumulative session tracking exists. But what is still missing: no dollar cost estimate, no cross-session tracking (resets on new session), no cross-agent aggregation in multi-agent setups, and no budget/threshold alerts. Token accounting exists; cost governance does not.'
    },
    {
      id: 'web-ui',
      title: 'Exploring the Web UI',
      content:
        '<h3>The ADK Dev Interface</h3>' +
        '<p>The <code>adk web</code> command launches a browser-based development interface that is, by far, the most important tool for understanding what your agent is actually doing. It is not just a chat window -- it is a full debugger for agent behavior.</p>' +
        '<pre><code>cd adk_hello\nadk web .</code></pre>' +
        '<p>The interface has several key areas:</p>' +
        '<ul>' +
        '<li><strong>Agent selector</strong> (top left) -- Choose which agent package to interact with. If you have multiple agent directories, they all appear here.</li>' +
        '<li><strong>Chat panel</strong> (center) -- Send messages and see agent responses. This is the basic interaction surface.</li>' +
        '<li><strong>Event inspector</strong> (right sidebar) -- Click any message to see the raw Event object. This is where the real debugging happens.</li>' +
        '<li><strong>Session panel</strong> -- Shows session state, session ID, and allows you to start new sessions.</li>' +
        '</ul>' +

        '<h3>The Event Inspector</h3>' +
        '<p>Every message in the chat corresponds to one or more Events. Clicking a message opens the Event inspector, which shows:</p>' +
        '<ul>' +
        '<li><strong>content</strong> -- The Parts array (text, function calls, function responses)</li>' +
        '<li><strong>state_delta</strong> -- Any state changes this event triggered. This is how you see the agent\'s "memory" evolving.</li>' +
        '<li><strong>actions</strong> -- Side effects: tool calls requested, state mutations, transfer actions (in multi-agent setups)</li>' +
        '<li><strong>author</strong> -- Which agent generated this event</li>' +
        '</ul>' +
        '<p>The Event inspector is the single most valuable debugging tool in ADK. Most developers never look past the chat panel, but the real understanding comes from reading raw events.</p>' +

        '<h3>The Trace Tab</h3>' +
        '<p>The Trace tab is where ADK exposes performance and cost data. Switch to it to see a span-based view of each model call:</p>' +
        '<ul>' +
        '<li><strong>Span name</strong> -- Usually the agent name or tool name</li>' +
        '<li><strong>Duration</strong> -- Wall-clock time for each operation</li>' +
        '<li><strong>input_tokens</strong> -- Tokens sent to the model (system prompt + conversation history + tool schemas)</li>' +
        '<li><strong>output_tokens</strong> -- Tokens the model generated</li>' +
        '</ul>' +
        '<p>These token counts are per-turn only. There is no built-in way to see cumulative token usage across a session, let alone across multiple sessions or agents. Each span is an island -- you can see that Turn 3 used 1,247 input tokens and 89 output tokens, but you cannot see that the session has used 4,521 total tokens so far.</p>' +

        '<h3>What the Trace Tab Reveals About Cost</h3>' +
        '<p>Pay attention to the <code>input_tokens</code> count across turns. In a typical conversation:</p>' +
        '<ul>' +
        '<li>Turn 1: ~200 input tokens (system prompt + first message)</li>' +
        '<li>Turn 2: ~400 input tokens (system prompt + 2 messages)</li>' +
        '<li>Turn 3: ~650 input tokens (system prompt + 3 messages)</li>' +
        '<li>Turn 10: ~2,500 input tokens (system prompt + 10 messages)</li>' +
        '</ul>' +
        '<p>Input tokens grow with every turn because ADK sends the full conversation history by default. This is the <code>include_contents</code> behavior we will cover in Agent Anatomy. For now, just notice the growth pattern -- it is linear and unbounded.</p>' +

        '<h3>Session Management</h3>' +
        '<p>The web UI creates a new session for each conversation. Sessions are identified by a UUID and stored in memory by default (they disappear when you restart <code>adk web</code>). You can:</p>' +
        '<ul>' +
        '<li>Start a new session (new conversation, clean state)</li>' +
        '<li>See session state (key-value pairs the agent has written)</li>' +
        '<li>Copy the session ID (useful for API testing)</li>' +
        '</ul>' +
        '<p>Sessions in the web UI use the <code>InMemorySessionService</code> by default. In production, you would configure a persistent session service backed by a database.</p>',

      summary: 'The adk web UI is a full agent debugger. The Event inspector shows raw event data (content, state_delta, actions). The Trace tab shows per-turn token counts (input_tokens, output_tokens) but has no cumulative tracking. Input tokens grow linearly with conversation length because full history is sent each turn.',

      mentalModel: 'The web UI is like Chrome DevTools for agents -- the chat panel is the rendered page, the Event inspector is the Elements panel, and the Trace tab is the Network/Performance panel. Most developers only look at the rendered page and miss the insights hiding in the dev tools.',

      mistakes: [
        'Not checking the Trace tab -- it is the most valuable view for understanding cost and performance. The chat panel only shows you the output; the Trace tab shows you the cost of producing it.',
        'Confusing Events with chat messages -- a single user turn can produce multiple Events (e.g., a tool call event + a response event). Each Event is a separate object in the stream.',
        'Missing the session state panel -- state changes are invisible in the chat but visible in the state panel. If your agent is supposed to remember something and is not, check here first.',
        'Ignoring input_tokens growth -- it is easy to miss that input tokens increase with every turn. By turn 20, you may be sending 5,000+ tokens per call just in conversation history.',
        'Assuming token data persists -- closing and reopening the web UI loses all trace data. If you need to analyze token usage patterns, copy the data before closing.'
      ],

      exercise:
        '<p><strong>Step 1: Launch the web UI</strong></p>' +
        '<pre><code>cd adk_hello\nadk web .</code></pre>' +
        '<p>Open the URL in your browser and select your greeting_agent.</p>' +

        '<p><strong>Step 2: Send 5 messages and inspect events</strong></p>' +
        '<p>Send these messages in sequence:</p>' +
        '<ol>' +
        '<li>"Hello, I\'m learning about ADK"</li>' +
        '<li>"What models does ADK support?"</li>' +
        '<li>"How is it different from LangChain?"</li>' +
        '<li>"Can you summarize what we\'ve discussed?"</li>' +
        '<li>"Thanks for your help!"</li>' +
        '</ol>' +
        '<p>After each message, click on the agent\'s response in the chat panel. Examine the Event object in the inspector. Note the <code>content.parts</code> array and any <code>actions</code>.</p>' +

        '<p><strong>Step 3: Switch to the Trace tab</strong></p>' +
        '<p>Click the "Trace" tab (or equivalent in your ADK version). For each of the 5 turns, record:</p>' +
        '<ul>' +
        '<li>input_tokens count</li>' +
        '<li>output_tokens count</li>' +
        '<li>Duration (ms)</li>' +
        '</ul>' +

        '<p><strong>Step 4: Build a token growth table</strong></p>' +
        '<p>Create a simple table from your observations:</p>' +
        '<pre><code>Turn | input_tokens | output_tokens | Cumulative Input\n' +
        '  1  |     ~200     |     ~80       |       ~200\n' +
        '  2  |     ~400     |     ~90       |       ~600\n' +
        '  3  |     ~650     |     ~100      |      ~1250\n' +
        '  4  |     ~950     |     ~120      |      ~2200\n' +
        '  5  |    ~1100     |     ~60       |      ~3300</code></pre>' +
        '<p>Your actual numbers will differ, but the pattern should be clear: input_tokens grows with every turn because the full conversation history is resent.</p>' +

        '<p><strong>Step 5: Look for cumulative token tracking</strong></p>' +
        '<p>Search the web UI for any view that shows total tokens used across all turns. Check every tab, every panel, every dropdown. You will not find one -- ADK tracks tokens per-turn but does not aggregate them.</p>' +

        '<p><strong>Step 6: Check session state</strong></p>' +
        '<p>Open the session state panel. Note that it is empty -- our simple greeting agent does not write any state. State tracking will become important in Section 4.</p>',

      postEvidence: 'The web UI shows per-event AND per-session token summaries -- cumulative tracking within a session exists (corrects our earlier assumption). But still missing: no dollar cost conversion, no cross-session totals, no cross-agent aggregation, no budget thresholds. Token accounting is solved; cost governance is not.'
    }
  ]
});
