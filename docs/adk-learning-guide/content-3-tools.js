window.COURSE_SECTIONS = window.COURSE_SECTIONS || [];
window.COURSE_SECTIONS.push({
  id: 'tools',
  title: '3. Tools System',
  topics: [
    {
      id: 'function-tools',
      title: 'Function Tools',
      content:
        '<h3>How ADK Wraps Functions into Tools</h3>' +
        '<p>In ADK, any plain Python function can become a tool. When you add a function to an agent\'s <code>tools</code> list, ADK automatically wraps it in a <code>FunctionTool</code> object. The framework uses Python\'s type hints and docstring to generate a JSON schema that tells the model what the tool does and what parameters it accepts.</p>' +
        '<pre><code>from google.adk.agents import Agent\n\n' +
        'def lookup_inventory(product_id: str, warehouse: str = \'main\') -&gt; dict:\n' +
        '    """Look up current inventory levels for a product.\n\n' +
        '    Args:\n' +
        '        product_id: The unique product identifier (e.g., "SKU-12345").\n' +
        '        warehouse: The warehouse to check. Defaults to "main".\n\n' +
        '    Returns:\n' +
        '        A dict with product details and stock level.\n' +
        '    """\n' +
        '    # In production, this would query a database\n' +
        '    return {\n' +
        '        \'status\': \'success\',\n' +
        '        \'product_id\': product_id,\n' +
        '        \'warehouse\': warehouse,\n' +
        '        \'quantity\': 42,\n' +
        '        \'unit\': \'units\'\n' +
        '    }\n\n' +
        'root_agent = Agent(\n' +
        '    name=\'inventory_agent\',\n' +
        '    model=\'gemini-2.5-flash\',\n' +
        '    instruction=\'You help users check product inventory. Use the lookup_inventory tool.\',\n' +
        '    tools=[lookup_inventory]  # ADK auto-wraps this into a FunctionTool\n' +
        ')</code></pre>' +

        '<h3>Schema Generation Rules</h3>' +
        '<p>ADK generates the tool schema from three sources, and getting them right is critical because the schema is what the model sees:</p>' +
        '<ul>' +
        '<li><strong>Function name</strong> becomes the tool name. Use descriptive, verb-first names (e.g., <code>lookup_inventory</code>, not <code>inv</code>).</li>' +
        '<li><strong>Docstring first line</strong> becomes the tool description. This is the most important piece -- the model reads this to decide when to use the tool.</li>' +
        '<li><strong>Args: section</strong> in the docstring maps to parameter descriptions. Each parameter name must match a function parameter exactly.</li>' +
        '<li><strong>Type hints</strong> define parameter types in the schema (<code>str</code>, <code>int</code>, <code>float</code>, <code>bool</code>, <code>list</code>, <code>dict</code>).</li>' +
        '<li><strong>Default values</strong> mark parameters as optional in the schema.</li>' +
        '</ul>' +
        '<p>If you omit the docstring, the model gets a tool with no description -- it will guess when to use it, often incorrectly. If you omit type hints, ADK cannot generate proper parameter types in the schema.</p>' +

        '<h3>Return Value Conventions</h3>' +
        '<p>Tool return values are sent back to the model as a <code>function_response</code> event. ADK serializes the return value to JSON. Best practices:</p>' +
        '<ul>' +
        '<li><strong>Return a dict</strong> with a <code>status</code> key (<code>\'success\'</code> or <code>\'error\'</code>). This gives the model a clear signal about whether the operation worked.</li>' +
        '<li><strong>Include relevant data</strong> in the dict. The model will use this data to formulate its response to the user.</li>' +
        '<li><strong>Keep return values concise</strong> -- every byte of the return value becomes input tokens on the next model call. Returning a 10,000-character JSON blob costs tokens.</li>' +
        '</ul>' +
        '<pre><code># Good: concise, structured, has status\n' +
        'return {\'status\': \'success\', \'price\': 29.99, \'currency\': \'USD\'}\n\n' +
        '# Bad: verbose, no status, unstructured\n' +
        'return f"The price of {product} is $29.99 in the main warehouse as of today"</code></pre>' +

        '<h3>Tool Schemas Cost Tokens</h3>' +
        '<p>Here is a fact that most developers miss: <strong>tool schemas are included in the system prompt on every single turn</strong>. When you add a function tool to an agent, ADK generates a JSON schema for that tool and appends it to the system prompt. This means:</p>' +
        '<ul>' +
        '<li>An agent with 1 simple tool: ~50 extra input tokens per turn</li>' +
        '<li>An agent with 5 tools: ~250 extra input tokens per turn</li>' +
        '<li>An agent with 20 tools and detailed docstrings: ~1,000+ extra input tokens per turn</li>' +
        '</ul>' +
        '<p>Over a 20-turn conversation, 20 tools add ~20,000 input tokens just for tool schemas. This is invisible cost -- you do not see it in the chat, and the Trace tab shows it as part of the input_tokens count without breaking it out separately.</p>' +

        '<h3>The Tool Call / Tool Result Cycle</h3>' +
        '<p>When the model decides to use a tool, ADK orchestrates a multi-event cycle:</p>' +
        '<ol>' +
        '<li><strong>Model generates a function_call</strong> -- an event with the tool name and arguments</li>' +
        '<li><strong>ADK executes the Python function</strong> with the provided arguments</li>' +
        '<li><strong>ADK sends a function_response</strong> back to the model with the return value</li>' +
        '<li><strong>Model generates the final response</strong> using the tool result</li>' +
        '</ol>' +
        '<p>This means a single user message that triggers a tool call results in <strong>two model calls</strong>: one to generate the function_call, and one to generate the response after receiving the function_response. Both calls are billed. If the model calls multiple tools in sequence, each one adds another round-trip.</p>',

      summary: 'Python functions auto-wrap into FunctionTool via type hints + docstrings. The docstring becomes the tool description the model reads. Tool schemas cost tokens on every turn (they are part of the system prompt). Tool calls trigger two model calls (call + response). Return dicts with a status key and keep return values concise.',

      mentalModel: 'Function tools are like plugins for a browser -- the agent discovers what is available by reading the schema (like a plugin manifest), then decides when to use each one. The schema is always loaded -- even if the tool is never called, its schema costs tokens on every turn.',

      mistakes: [
        'Writing poor docstrings -- the docstring first line becomes the tool description the LLM reads. A vague description like "Does inventory stuff" will cause the model to misuse the tool. Write clear, specific descriptions like "Look up current inventory levels for a product in a specific warehouse."',
        'Using complex types that do not serialize well -- nested dataclasses, custom objects, or types without obvious JSON representation will cause serialization errors. Stick to primitives, lists, and dicts.',
        'Not including a status field in the return dict -- without it, the model cannot easily distinguish success from failure. Always return {\'status\': \'success\', ...} or {\'status\': \'error\', \'message\': ...}.',
        'Forgetting that tool schemas cost tokens in every turn -- adding 20 tools to an agent adds ~1,000 input tokens to every single API call, even turns where no tools are used. Only attach tools the agent actually needs.',
        'Returning verbose tool results -- the entire return value is sent back to the model as input tokens. A 5,000-character JSON response costs tokens. Summarize and filter before returning.'
      ],

      exercise:
        '<p><strong>Step 1: Create the project structure</strong></p>' +
        '<pre><code>mkdir -p adk_tools/shop_agent</code></pre>' +

        '<p><strong>Step 2: Build two function tools with proper docstrings</strong></p>' +
        '<p>Create <code>adk_tools/shop_agent/__init__.py</code>:</p>' +
        '<pre><code>from google.adk.agents import Agent\n\n\n' +
        'def lookup_inventory(product_id: str, warehouse: str = \'main\') -&gt; dict:\n' +
        '    """Look up current inventory levels for a product.\n\n' +
        '    Args:\n' +
        '        product_id: The unique product identifier (e.g., "SKU-001").\n' +
        '        warehouse: Which warehouse to check. Defaults to "main".\n\n' +
        '    Returns:\n' +
        '        Inventory status including quantity and warehouse location.\n' +
        '    """\n' +
        '    inventory_db = {\n' +
        '        \'SKU-001\': {\'name\': \'Wireless Mouse\', \'quantity\': 142, \'price\': 29.99},\n' +
        '        \'SKU-002\': {\'name\': \'USB-C Hub\', \'quantity\': 0, \'price\': 49.99},\n' +
        '        \'SKU-003\': {\'name\': \'Mechanical Keyboard\', \'quantity\': 37, \'price\': 89.99},\n' +
        '    }\n' +
        '    product = inventory_db.get(product_id)\n' +
        '    if not product:\n' +
        '        return {\'status\': \'error\', \'message\': f\'Product {product_id} not found\'}\n' +
        '    return {\n' +
        '        \'status\': \'success\',\n' +
        '        \'product_id\': product_id,\n' +
        '        \'name\': product[\'name\'],\n' +
        '        \'warehouse\': warehouse,\n' +
        '        \'quantity\': product[\'quantity\'],\n' +
        '        \'in_stock\': product[\'quantity\'] &gt; 0,\n' +
        '        \'price\': product[\'price\']\n' +
        '    }\n\n\n' +
        'def calculate_shipping(weight_kg: float, destination: str, express: bool = False) -&gt; dict:\n' +
        '    """Calculate shipping cost for a package.\n\n' +
        '    Args:\n' +
        '        weight_kg: Package weight in kilograms.\n' +
        '        destination: Destination country code (e.g., "US", "DE", "JP").\n' +
        '        express: Whether to use express shipping. Defaults to False.\n\n' +
        '    Returns:\n' +
        '        Shipping cost breakdown including base rate and total.\n' +
        '    """\n' +
        '    base_rates = {\'US\': 5.99, \'DE\': 12.99, \'JP\': 15.99, \'GB\': 10.99}\n' +
        '    base = base_rates.get(destination, 19.99)\n' +
        '    weight_surcharge = max(0, (weight_kg - 1.0)) * 2.50\n' +
        '    express_multiplier = 2.5 if express else 1.0\n' +
        '    total = (base + weight_surcharge) * express_multiplier\n' +
        '    return {\n' +
        '        \'status\': \'success\',\n' +
        '        \'destination\': destination,\n' +
        '        \'weight_kg\': weight_kg,\n' +
        '        \'base_rate\': base,\n' +
        '        \'weight_surcharge\': round(weight_surcharge, 2),\n' +
        '        \'express\': express,\n' +
        '        \'total\': round(total, 2),\n' +
        '        \'currency\': \'USD\',\n' +
        '        \'estimated_days\': \'2-3\' if express else \'7-10\'\n' +
        '    }\n\n\n' +
        'root_agent = Agent(\n' +
        '    name=\'shop_agent\',\n' +
        '    model=\'gemini-2.5-flash\',\n' +
        '    instruction=(\n' +
        '        \'You are a shopping assistant for an electronics store. \'\n' +
        '        \'Help customers check product availability and calculate shipping costs. \'\n' +
        '        \'Available products: SKU-001 (Wireless Mouse), SKU-002 (USB-C Hub), SKU-003 (Mechanical Keyboard). \'\n' +
        '        \'Always check inventory before quoting prices. \'\n' +
        '        \'If a product is out of stock, let the customer know and suggest alternatives.\'\n' +
        '    ),\n' +
        '    tools=[lookup_inventory, calculate_shipping]\n' +
        ')</code></pre>' +

        '<p><strong>Step 3: Test the agent</strong></p>' +
        '<pre><code>cd adk_tools\nadk web .</code></pre>' +
        '<p>Send these messages in sequence:</p>' +
        '<ol>' +
        '<li>"Is the wireless mouse in stock?" -- should trigger lookup_inventory</li>' +
        '<li>"How much to ship it to Germany?" -- should trigger calculate_shipping</li>' +
        '<li>"What about the USB-C hub?" -- should trigger lookup_inventory, then report out of stock</li>' +
        '<li>"Ship the keyboard to Japan, express" -- should trigger both tools in sequence</li>' +
        '</ol>' +

        '<p><strong>Step 4: Inspect the tool call events</strong></p>' +
        '<p>For message #1, click each event in the Event inspector. You should see:</p>' +
        '<ul>' +
        '<li>A <code>function_call</code> event with name "lookup_inventory" and args {"product_id": "SKU-001"}</li>' +
        '<li>A <code>function_response</code> event with the return dict</li>' +
        '<li>A final text response event using the tool result</li>' +
        '</ul>' +

        '<p><strong>Step 5: Check token cost of tool schemas</strong></p>' +
        '<p>In the Trace tab, look at the input_tokens for the first turn. Then remove one tool from the agent (comment out <code>calculate_shipping</code> from the tools list), restart <code>adk web</code>, and send the same first message. Compare input_tokens -- the difference is the token cost of the calculate_shipping schema.</p>' +

        '<p><strong>Step 6: Observe the two-call pattern</strong></p>' +
        '<p>In the Trace tab, notice that a single user message that triggers a tool call produces <strong>two spans</strong>: one for the function_call generation, and one for the final response after the function_response. Both are billed. Record the input_tokens and output_tokens for each span separately.</p>'
    },
    {
      id: 'long-running-tools',
      title: 'Long-Running Tools',
      content:
        '<h3>The Problem: Slow Operations</h3>' +
        '<p>Some tool operations take minutes or hours -- waiting for a human approval, processing a large file, calling a slow external API. A normal function tool blocks the agent until it returns. For quick operations (database lookups, calculations), blocking is fine. For slow operations, you need a different pattern.</p>' +

        '<h3>LongRunningFunctionTool</h3>' +
        '<p>ADK provides <code>LongRunningFunctionTool</code> for exactly this case. It wraps a function that returns an initial "pending" result, then the agent pauses and waits for a completion signal from the client. The pattern is:</p>' +
        '<ol>' +
        '<li><strong>Agent calls the tool</strong> -- ADK executes your function</li>' +
        '<li><strong>Function returns a pending result</strong> -- a dict indicating the operation has started but not completed</li>' +
        '<li><strong>Agent yields</strong> -- it sends a response to the user indicating it is waiting, then pauses</li>' +
        '<li><strong>Client sends completion</strong> -- when the external operation finishes, the client sends a completion signal with the final result</li>' +
        '<li><strong>Agent resumes</strong> -- it receives the completion data and continues processing</li>' +
        '</ol>' +
        '<pre><code>from google.adk.agents import Agent\n' +
        'from google.adk.tools import LongRunningFunctionTool\n\n\n' +
        'def request_manager_approval(request_id: str, amount: float) -&gt; dict:\n' +
        '    """Request manager approval for a purchase.\n\n' +
        '    Args:\n' +
        '        request_id: The purchase request identifier.\n' +
        '        amount: The dollar amount requiring approval.\n\n' +
        '    Returns:\n' +
        '        Initial pending status. Final result arrives via completion.\n' +
        '    """\n' +
        '    # This returns immediately with a pending status.\n' +
        '    # The actual approval happens externally (email, Slack, etc.)\n' +
        '    return {\n' +
        '        \'status\': \'pending\',\n' +
        '        \'request_id\': request_id,\n' +
        '        \'message\': f\'Approval request sent for ${amount}. Waiting for manager response.\'\n' +
        '    }\n\n\n' +
        'root_agent = Agent(\n' +
        '    name=\'purchase_agent\',\n' +
        '    model=\'gemini-2.5-flash\',\n' +
        '    instruction=(\n' +
        '        \'You help employees make purchase requests. \'\n' +
        '        \'For any purchase over $100, use the request_manager_approval tool. \'\n' +
        '        \'Tell the user you are waiting for approval after submitting the request.\'\n' +
        '    ),\n' +
        '    tools=[LongRunningFunctionTool(func=request_manager_approval)]\n' +
        ')</code></pre>' +

        '<h3>The Yield/Pause/Resume Pattern</h3>' +
        '<p>This is the key architectural insight: ADK already has a built-in mechanism for <strong>interrupting and resuming agent execution</strong>. When a LongRunningFunctionTool is triggered:</p>' +
        '<ul>' +
        '<li>The agent\'s execution is <strong>suspended</strong> -- it does not consume model calls while waiting</li>' +
        '<li>The session state is <strong>preserved</strong> -- the agent can resume exactly where it left off</li>' +
        '<li>The client controls <strong>when to resume</strong> -- by sending the completion signal</li>' +
        '</ul>' +
        '<p>This is the same interrupt pattern that a scheduler could exploit. Instead of waiting for an external approval, a scheduler could pause an agent because it is over budget, over its rate limit, or because a higher-priority agent needs the model capacity. The mechanism already exists -- it just is not used for resource management.</p>' +

        '<h3>Completion Signal</h3>' +
        '<p>To resume the agent, the client sends a completion signal through the session. In the web UI, this appears as a special event. Programmatically, you send a function response with the tool\'s <code>function_call_id</code>:</p>' +
        '<pre><code># Client-side: sending completion\n' +
        '# This is typically done via the API, not in agent code\n' +
        'completion_data = {\n' +
        '    \'status\': \'approved\',\n' +
        '    \'approved_by\': \'manager@company.com\',\n' +
        '    \'approved_at\': \'2026-06-04T10:30:00Z\'\n' +
        '}</code></pre>' +
        '<p>The agent receives this data as a function_response and continues its execution with the approval result.</p>' +

        '<h3>When to Use LongRunningFunctionTool</h3>' +
        '<ul>' +
        '<li><strong>Human-in-the-loop approvals</strong> -- purchase requests, access grants, content reviews</li>' +
        '<li><strong>External processing</strong> -- file conversions, batch jobs, third-party API calls that take minutes</li>' +
        '<li><strong>Webhook-driven workflows</strong> -- the agent starts a process, a webhook fires when it completes</li>' +
        '</ul>' +
        '<p>Do <strong>not</strong> use LongRunningFunctionTool for operations that complete in seconds. The overhead of the yield/resume cycle (serializing state, waiting for completion signal) is not worth it for fast operations. Use a regular function tool instead.</p>',

      summary: 'LongRunningFunctionTool enables yield/pause/resume for slow operations like approvals. The agent suspends execution (no model calls while waiting), preserves session state, and resumes when the client sends a completion signal. This interrupt mechanism already exists in ADK -- it could be repurposed for resource-aware scheduling.',

      mentalModel: 'Like sending an email and waiting for a reply -- the agent does not sit at its desk refreshing the inbox. It yields control, goes to sleep, and wakes up when the reply arrives. The "inbox" is the session, and the "reply" is the completion signal.',

      mistakes: [
        'Using LongRunningFunctionTool for fast operations -- the yield/resume overhead (state serialization, completion signaling) adds complexity without benefit. If the operation takes less than a few seconds, use a regular function tool.',
        'Not handling the pending state in the client -- when the agent yields, the client must know to wait for a completion signal. If the client ignores the pending state, the agent hangs forever.',
        'Confusing LongRunningFunctionTool with async Python functions -- they are different concepts. Python async/await is about non-blocking I/O within a single process. LongRunningFunctionTool is about pausing the entire agent execution and resuming later, potentially hours later.',
        'Forgetting to send the completion signal -- the agent will remain suspended indefinitely. In production, you need a timeout or cleanup mechanism for abandoned long-running operations.',
        'Not preserving the function_call_id -- the completion signal must reference the correct function_call_id to resume the right tool invocation. Losing this ID means you cannot resume the agent.'
      ],

      exercise:
        '<p><strong>Step 1: Create the project structure</strong></p>' +
        '<pre><code>mkdir -p adk_longrun/approval_agent</code></pre>' +

        '<p><strong>Step 2: Build an agent with a long-running tool</strong></p>' +
        '<p>Create <code>adk_longrun/approval_agent/__init__.py</code>:</p>' +
        '<pre><code>from google.adk.agents import Agent\n' +
        'from google.adk.tools import LongRunningFunctionTool\n\n\n' +
        'def request_approval(request_type: str, details: str) -&gt; dict:\n' +
        '    """Request approval from a manager for a sensitive operation.\n\n' +
        '    Args:\n' +
        '        request_type: Type of approval needed (e.g., "purchase", "access", "deploy").\n' +
        '        details: Description of what needs approval.\n\n' +
        '    Returns:\n' +
        '        Pending status while waiting for manager response.\n' +
        '    """\n' +
        '    return {\n' +
        '        \'status\': \'pending\',\n' +
        '        \'request_type\': request_type,\n' +
        '        \'message\': f\'Approval request submitted for: {details}. Waiting for manager.\'\n' +
        '    }\n\n\n' +
        'root_agent = Agent(\n' +
        '    name=\'approval_agent\',\n' +
        '    model=\'gemini-2.5-flash\',\n' +
        '    instruction=(\n' +
        '        \'You are an operations assistant. When users request sensitive operations \'\n' +
        '        \'(purchases over $50, access to production systems, deployments), \'\n' +
        '        \'use the request_approval tool and tell the user you are waiting for manager approval. \'\n' +
        '        \'For non-sensitive requests, respond directly.\'\n' +
        '    ),\n' +
        '    tools=[LongRunningFunctionTool(func=request_approval)]\n' +
        ')</code></pre>' +

        '<p><strong>Step 3: Trigger the long-running tool</strong></p>' +
        '<pre><code>cd adk_longrun\nadk web .</code></pre>' +
        '<p>Send: "I need to buy a new monitor for $350"</p>' +
        '<p>The agent should call request_approval and then tell you it is waiting for approval.</p>' +

        '<p><strong>Step 4: Observe the pending state</strong></p>' +
        '<p>In the Event inspector, examine the events. You should see:</p>' +
        '<ul>' +
        '<li>A function_call event for request_approval</li>' +
        '<li>A function_response event with status "pending"</li>' +
        '<li>The agent\'s message telling you it is waiting</li>' +
        '</ul>' +
        '<p>Note: the agent is now <strong>paused</strong>. It is not making model calls. It is waiting for a completion signal.</p>' +

        '<p><strong>Step 5: Send the completion signal</strong></p>' +
        '<p>In the web UI, you can simulate the completion by sending a follow-up message. The exact mechanism depends on your ADK version -- in some versions, you can directly send a function response via the UI. In the API server mode, you would send a POST with the function_call_id and result data.</p>' +

        '<p><strong>Step 6: Reflect on the scheduling implications</strong></p>' +
        '<p>Consider: if ADK can pause an agent waiting for a human approval, it could also pause an agent waiting for a scheduler\'s permission. The yield/pause/resume mechanism is generic -- the "reason for pausing" (human approval vs. rate limit vs. budget exceeded) is just a policy decision, not an architectural one.</p>',

      postEvidence: 'ADK already has a yield/pause/resume pattern for tools. A scheduler could use this same mechanism to pause agents under load and resume them when capacity is available. The interrupt infrastructure exists -- what is missing is the scheduling policy that decides when to pause and resume.'
    },
    {
      id: 'tool-context',
      title: 'ToolContext Deep Dive',
      content:
        '<h3>What is ToolContext?</h3>' +
        '<p><code>ToolContext</code> is a special object that ADK passes to your tool function when it is called. It provides access to the agent\'s runtime context -- state, credentials, artifacts, memory, and identity. Think of it as the agent\'s wallet: it carries everything the agent needs to interact with the outside world.</p>' +
        '<p>To use ToolContext, add it as a parameter to your function with the <code>tool_context</code> name. ADK will automatically inject it -- you do not pass it manually:</p>' +
        '<pre><code>from google.adk.tools import ToolContext\n\n\n' +
        'def my_tool(query: str, tool_context: ToolContext) -&gt; dict:\n' +
        '    """A tool that uses context.\n\n' +
        '    Args:\n' +
        '        query: The search query.\n' +
        '    """\n' +
        '    # tool_context is injected by ADK, not by the model\n' +
        '    agent_name = tool_context.agent_name\n' +
        '    current_state = tool_context.state\n' +
        '    return {\'status\': \'success\', \'agent\': agent_name}</code></pre>' +
        '<p>Note that <code>tool_context</code> is <strong>not</strong> included in the tool schema sent to the model. The model does not know it exists and cannot pass it as an argument. ADK handles the injection behind the scenes.</p>' +

        '<h3>ToolContext Inheritance</h3>' +
        '<p><code>ToolContext</code> extends <code>CallbackContext</code>, which means everything available in before/after model callbacks is also available in tool functions. The inheritance chain is:</p>' +
        '<pre><code>CallbackContext\n' +
        '  &gt; state (read/write session state)\n' +
        '  &gt; agent_name (current agent\'s name)\n' +
        '  &gt; invocation_id (current turn\'s ID)\n' +
        '  &gt; actions (state_delta, skip_summarization, etc.)\n' +
        '  \\\n' +
        '   ToolContext (adds tool-specific features)\n' +
        '     &gt; function_call_id (ID of this specific tool invocation)\n' +
        '     &gt; request_credential() (OAuth/API key flows)\n' +
        '     &gt; get_auth_response() (retrieve credential after auth)\n' +
        '     &gt; search_memory() (semantic search over agent memory)\n' +
        '     &gt; list_artifacts() / load_artifact() / save_artifact() (file management)</code></pre>' +

        '<h3>Reading and Writing State</h3>' +
        '<p>The most common use of ToolContext is reading and writing session state. But there is a critical distinction between <strong>reading</strong> (direct access) and <strong>writing</strong> (must use actions.state_delta):</p>' +
        '<pre><code>def stateful_tool(action: str, tool_context: ToolContext) -&gt; dict:\n' +
        '    """A tool that reads and writes session state.\n\n' +
        '    Args:\n' +
        '        action: What action to perform.\n' +
        '    """\n' +
        '    # READING state -- direct access is fine\n' +
        '    visit_count = tool_context.state.get(\'visit_count\', 0)\n' +
        '    user_name = tool_context.state.get(\'user_name\', \'anonymous\')\n\n' +
        '    # WRITING state -- MUST use actions.state_delta\n' +
        '    new_count = visit_count + 1\n' +
        '    tool_context.actions.state_delta[\'visit_count\'] = new_count\n' +
        '    tool_context.actions.state_delta[\'last_action\'] = action\n\n' +
        '    # DO NOT do this -- it does not persist:\n' +
        '    # tool_context.state[\'visit_count\'] = new_count  # WRONG!\n\n' +
        '    return {\n' +
        '        \'status\': \'success\',\n' +
        '        \'visit_count\': new_count,\n' +
        '        \'user\': user_name\n' +
        '    }</code></pre>' +
        '<p>Why the asymmetry? <code>tool_context.state</code> is a <strong>snapshot</strong> of the session state at the time the tool was called. Modifying it directly changes the local copy but does not propagate back to the session. The <code>actions.state_delta</code> is a diff that ADK applies to the session after the tool completes -- this is the only way to persist state changes.</p>' +

        '<h3>The agent_name Field</h3>' +
        '<p>In single-agent setups, <code>tool_context.agent_name</code> always matches the agent you defined. But in multi-agent setups, a tool can be called by different agents. The <code>agent_name</code> field tells you <strong>which agent is currently running this tool</strong>:</p>' +
        '<pre><code>def shared_tool(query: str, tool_context: ToolContext) -&gt; dict:\n' +
        '    """A tool shared across multiple agents.\n\n' +
        '    Args:\n' +
        '        query: The query to process.\n' +
        '    """\n' +
        '    caller = tool_context.agent_name\n' +
        '    if caller == \'billing_agent\':\n' +
        '        # Apply billing-specific logic\n' +
        '        return {\'status\': \'success\', \'data\': \'billing result\'}\n' +
        '    elif caller == \'support_agent\':\n' +
        '        # Apply support-specific logic\n' +
        '        return {\'status\': \'success\', \'data\': \'support result\'}\n' +
        '    return {\'status\': \'success\', \'data\': \'generic result\'}</code></pre>' +
        '<p>This is important for security and auditing -- you always know which agent triggered a tool call.</p>' +

        '<h3>Credentials and Authentication</h3>' +
        '<p>ToolContext provides <code>request_credential()</code> for OAuth and API key flows. When your tool needs to call an external API that requires authentication:</p>' +
        '<pre><code>def call_external_api(endpoint: str, tool_context: ToolContext) -&gt; dict:\n' +
        '    """Call an external API with authentication.\n\n' +
        '    Args:\n' +
        '        endpoint: The API endpoint to call.\n' +
        '    """\n' +
        '    # Check if we already have credentials\n' +
        '    auth = tool_context.get_auth_response()\n' +
        '    if not auth:\n' +
        '        # Request credentials -- this triggers an OAuth flow\n' +
        '        tool_context.request_credential(\n' +
        '            auth_config=your_auth_config\n' +
        '        )\n' +
        '        return {\'status\': \'pending\', \'message\': \'Authentication required\'}\n\n' +
        '    # Use the credential\n' +
        '    token = auth.access_token\n' +
        '    # ... make API call with token\n' +
        '    return {\'status\': \'success\', \'data\': \'api result\'}</code></pre>' +

        '<h3>What ToolContext Tells a Scheduler</h3>' +
        '<p>From a scheduling perspective, ToolContext is the richest context object in ADK. It contains:</p>' +
        '<ul>' +
        '<li><strong>Who</strong> is running (agent_name)</li>' +
        '<li><strong>What</strong> they are doing (function_call_id, the tool being executed)</li>' +
        '<li><strong>What they know</strong> (state -- accumulated session data)</li>' +
        '<li><strong>What they need</strong> (credentials, memory, artifacts)</li>' +
        '</ul>' +
        '<p>A scheduler reading ToolContext could make informed decisions: "This agent has been running for 15 turns (state shows high visit_count), has used 3 tools, and is now requesting credentials for an expensive API. Time to check the budget."</p>',

      summary: 'ToolContext provides access to state, credentials, memory, artifacts, and agent identity. It extends CallbackContext, so everything in callbacks is available in tools. Read state directly (tool_context.state), but write state through actions.state_delta (direct writes do not persist). The agent_name field identifies which agent is calling the tool in multi-agent setups.',

      mentalModel: 'ToolContext is the agent\'s wallet -- it carries credentials (authentication), state (memory), identity (agent_name), and artifacts (files). Anything the agent needs to interact with the outside world goes through ToolContext. And like a wallet, a security guard (scheduler) could inspect it before allowing a transaction.',

      mistakes: [
        'Modifying tool_context.state directly instead of using actions.state_delta -- direct modification changes a local snapshot but does not persist to the session. Only state_delta changes survive after the tool completes. This is the #1 ToolContext bug.',
        'Not checking agent_name in multi-agent setups -- if a tool is shared across agents, you might be running in a different agent context than expected. A billing tool called by a support agent might need different permissions.',
        'Forgetting that ToolContext extends CallbackContext -- everything available in before_model_callback and after_model_callback is also available in ToolContext. You do not need to duplicate logic.',
        'Ignoring function_call_id -- this ID uniquely identifies a specific tool invocation. It is required for completing long-running tools and useful for logging/auditing. Do not discard it.',
        'Not using state_delta for accumulated data -- if multiple tools in the same turn write to the same state key via state_delta, the last write wins. Design your state keys to avoid conflicts, or use list-append patterns.'
      ],

      exercise:
        '<p><strong>Step 1: Create the project structure</strong></p>' +
        '<pre><code>mkdir -p adk_context/context_agent</code></pre>' +

        '<p><strong>Step 2: Build a tool that uses ToolContext extensively</strong></p>' +
        '<p>Create <code>adk_context/context_agent/__init__.py</code>:</p>' +
        '<pre><code>from google.adk.agents import Agent\n' +
        'from google.adk.tools import ToolContext\n\n\n' +
        'def track_interaction(action: str, detail: str, tool_context: ToolContext) -&gt; dict:\n' +
        '    """Track a user interaction and update session statistics.\n\n' +
        '    Args:\n' +
        '        action: The type of interaction (e.g., "search", "purchase", "support").\n' +
        '        detail: Description of the specific interaction.\n' +
        '    """\n' +
        '    # READ current state\n' +
        '    interaction_count = tool_context.state.get(\'interaction_count\', 0)\n' +
        '    history = tool_context.state.get(\'action_history\', [])\n' +
        '    agent = tool_context.agent_name\n' +
        '    call_id = tool_context.function_call_id\n\n' +
        '    # WRITE new state via state_delta\n' +
        '    new_count = interaction_count + 1\n' +
        '    new_history = history + [f\'{action}: {detail}\']\n\n' +
        '    tool_context.actions.state_delta[\'interaction_count\'] = new_count\n' +
        '    tool_context.actions.state_delta[\'action_history\'] = new_history\n' +
        '    tool_context.actions.state_delta[\'last_agent\'] = agent\n\n' +
        '    return {\n' +
        '        \'status\': \'success\',\n' +
        '        \'interaction_number\': new_count,\n' +
        '        \'agent_name\': agent,\n' +
        '        \'function_call_id\': call_id,\n' +
        '        \'total_actions\': len(new_history)\n' +
        '    }\n\n\n' +
        'def get_session_summary(tool_context: ToolContext) -&gt; dict:\n' +
        '    """Get a summary of all interactions in this session.\n' +
        '    """\n' +
        '    count = tool_context.state.get(\'interaction_count\', 0)\n' +
        '    history = tool_context.state.get(\'action_history\', [])\n' +
        '    last_agent = tool_context.state.get(\'last_agent\', \'none\')\n\n' +
        '    return {\n' +
        '        \'status\': \'success\',\n' +
        '        \'total_interactions\': count,\n' +
        '        \'action_history\': history,\n' +
        '        \'last_agent\': last_agent,\n' +
        '        \'current_agent\': tool_context.agent_name\n' +
        '    }\n\n\n' +
        'root_agent = Agent(\n' +
        '    name=\'context_agent\',\n' +
        '    model=\'gemini-2.5-flash\',\n' +
        '    instruction=(\n' +
        '        \'You are a customer service agent. Track every user interaction \'\n' +
        '        \'using the track_interaction tool. When the user asks for a summary, \'\n' +
        '        \'use get_session_summary. Categories for actions: search, purchase, \'\n' +
        '        \'support, feedback.\'\n' +
        '    ),\n' +
        '    tools=[track_interaction, get_session_summary]\n' +
        ')</code></pre>' +

        '<p><strong>Step 3: Run and observe state accumulation</strong></p>' +
        '<pre><code>cd adk_context\nadk web .</code></pre>' +
        '<p>Send these messages:</p>' +
        '<ol>' +
        '<li>"I want to search for wireless headphones"</li>' +
        '<li>"I\'d like to purchase the Sony WH-1000XM5"</li>' +
        '<li>"Actually, I need support with my previous order"</li>' +
        '<li>"Give me a summary of our session"</li>' +
        '</ol>' +

        '<p><strong>Step 4: Inspect state in the session panel</strong></p>' +
        '<p>After each message, check the session state panel in the web UI. You should see:</p>' +
        '<ul>' +
        '<li><code>interaction_count</code> incrementing: 1, 2, 3</li>' +
        '<li><code>action_history</code> growing with each interaction</li>' +
        '<li><code>last_agent</code> set to "context_agent"</li>' +
        '</ul>' +

        '<p><strong>Step 5: Verify state_delta vs direct mutation</strong></p>' +
        '<p>Temporarily change the tool to use direct state mutation instead of state_delta:</p>' +
        '<pre><code># Change this:\n' +
        'tool_context.actions.state_delta[\'interaction_count\'] = new_count\n\n' +
        '# To this (WRONG -- will not persist):\n' +
        'tool_context.state[\'interaction_count\'] = new_count</code></pre>' +
        '<p>Restart <code>adk web</code>, send the same messages, and check the session state panel. The interaction_count should stay at 0 (or not appear) because direct mutations do not persist. Revert the change after testing.</p>' +

        '<p><strong>Step 6: Note what a scheduler would need</strong></p>' +
        '<p>Look at the fields available in ToolContext and consider what a scheduler would want to read:</p>' +
        '<ul>' +
        '<li><code>agent_name</code> -- which agent is consuming resources</li>' +
        '<li><code>state[\'interaction_count\']</code> -- how active this session is</li>' +
        '<li><code>function_call_id</code> -- for tracking individual tool invocations</li>' +
        '<li>Missing: token count, model cost, rate limit status, budget remaining</li>' +
        '</ul>' +
        '<p>ToolContext has identity and state but no resource awareness. A LOCO adapter would need to inject resource data into this context.</p>'
    }
  ]
});
