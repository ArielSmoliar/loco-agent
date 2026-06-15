window.COURSE_SECTIONS = window.COURSE_SECTIONS || [];
window.COURSE_SECTIONS.push({
  id: 'state',
  title: '4. State Architecture',
  topics: [
    {
      id: 'state-prefixes',
      title: 'State Prefix Scoping',
      content:
        '<p>ADK\'s state system uses <strong>prefix-based scoping</strong> to control the lifetime and visibility of state variables. This is not a key-value store with access controls -- it is a naming convention that the SessionService interprets to determine persistence behavior. Understanding these four scopes is fundamental to building multi-agent systems that share data correctly.</p>' +

        '<h3>The Four Scopes</h3>' +
        '<table>' +
        '<tr><th>Prefix</th><th>Scope</th><th>Lifetime</th><th>Visibility</th><th>Persistence</th></tr>' +
        '<tr><td><code>(none)</code></td><td>Session</td><td>Current session only</td><td>All agents in this session</td><td>In-memory or persisted with session</td></tr>' +
        '<tr><td><code>temp:</code></td><td>Invocation</td><td>Current invocation only</td><td>All agents in this invocation</td><td>Never persisted -- discarded after invocation completes</td></tr>' +
        '<tr><td><code>user:</code></td><td>User</td><td>All sessions for this user</td><td>All sessions belonging to the same user_id</td><td>Requires DatabaseSessionService or VertexAI</td></tr>' +
        '<tr><td><code>app:</code></td><td>Application</td><td>All users, all sessions</td><td>Globally visible to every agent, every user</td><td>Requires DatabaseSessionService or VertexAI</td></tr>' +
        '</table>' +

        '<h3>How State Updates Work</h3>' +
        '<p>There are three ways to update state in ADK, each suited to a different context:</p>' +
        '<p><strong>1. output_key on LlmAgent</strong> -- The simplest mechanism. When you set <code>output_key="result"</code> on an agent, ADK automatically saves the agent\'s final text response to <code>session.state["result"]</code>. This is the primary data-passing mechanism for SequentialAgent pipelines.</p>' +
        '<pre><code>agent = LlmAgent(\n    name=\'researcher\',\n    model=\'gemini-2.5-flash\',\n    instruction=\'Research the given topic thoroughly.\',\n    output_key=\'research_findings\'  # auto-saves response to state\n)</code></pre>' +

        '<p><strong>2. EventActions(state_delta={...})</strong> -- For complex, multi-key updates from within tools or callbacks. The state_delta is a dictionary of changes that gets applied atomically.</p>' +
        '<pre><code>from google.adk.events import EventActions\n\ndef my_tool(context):\n    # Update multiple state keys at once\n    actions = EventActions(state_delta={\n        \'result_count\': 42,\n        \'temp:processing_stage\': \'complete\',\n        \'user:preference\': \'detailed\'\n    })\n    return actions</code></pre>' +

        '<p><strong>3. context.state["key"] = value</strong> -- Direct assignment inside callbacks or tool functions. This is the most flexible approach but requires care -- you must use the context object provided by ADK, not a raw session reference.</p>' +
        '<pre><code>def before_agent(ctx):\n    ctx.state[\'visit_count\'] = ctx.state.get(\'visit_count\', 0) + 1\n    ctx.state[\'temp:start_time\'] = time.time()\n    return None  # proceed normally</code></pre>' +

        '<h3>Critical Rules</h3>' +
        '<p><strong>Never modify session.state directly from a retrieved session object.</strong> If you call <code>session_service.get_session()</code> and then modify the returned session\'s state dictionary, those changes will not persist. The SessionService does not watch for mutations on retrieved objects. Always use context objects (CallbackContext, ToolContext) or EventActions to update state.</p>' +
        '<pre><code># WRONG -- changes will NOT persist\nsession = await session_service.get_session(app_name, user_id, session_id)\nsession.state[\'key\'] = \'value\'  # silently lost\n\n# RIGHT -- use context inside a callback or tool\ndef my_callback(ctx):\n    ctx.state[\'key\'] = \'value\'  # properly tracked and persisted</code></pre>' +

        '<p><strong>In-memory SessionService loses everything on restart.</strong> The default <code>InMemorySessionService</code> stores state in Python dictionaries. When the process exits, all state is gone. For any production use, you need <code>DatabaseSessionService</code> (backed by a real database) or the Vertex AI session service.</p>' +

        '<p><strong>The app: prefix is globally visible.</strong> Any agent, in any session, for any user, can read and write <code>app:</code>-prefixed state. This makes it a powerful coordination channel -- agents can share configuration, feature flags, or aggregated metrics without external infrastructure. But it is also a security risk: sensitive data in <code>app:</code> state is visible to every user of the application.</p>' +

        '<h3>State as a Coordination Channel</h3>' +
        '<p>The combination of scoping prefixes and shared visibility creates a simple but effective inter-agent coordination mechanism. A monitoring agent can write <code>app:system_load = "high"</code>, and a routing agent in a completely different session can read that value and adjust its behavior. No message queue, no external database, no pub/sub -- just shared state with a naming convention.</p>' +
        '<p>This is also where the scheduling gap lives. ADK provides the mechanism for agents to share load signals, but ships no agent that actually uses it for scheduling decisions. The <code>app:</code> prefix is the coordination bus -- it just has no scheduler connected to it.</p>',

      summary: 'ADK state uses four prefix-based scopes (none, temp:, user:, app:) with three update mechanisms (output_key, EventActions, context.state). Never modify session.state directly from a retrieved object. The app: prefix is a global coordination channel that no built-in agent uses for scheduling.',

      mentalModel: 'State prefixes are like variable scopes in programming -- local (no prefix), function-scoped (temp:), user-global (user:), and application-global (app:). The scope determines lifetime and visibility, just like let vs const vs global in JavaScript.',

      mistakes: [
        'Modifying session.state directly from a retrieved session object -- changes will not persist. Always use context objects or EventActions.',
        'Expecting temp: values to survive across invocations -- they are discarded after each invocation completes, by design.',
        'Using InMemorySessionService in production -- all state is lost on process restart. Use DatabaseSessionService or Vertex AI.',
        'Storing sensitive data with the app: prefix -- it is visible to ALL users and ALL sessions. Treat app: state as public within your application.'
      ],

      exercise:
        '<p><strong>Goal:</strong> Verify scope behavior by writing to all four scopes and observing what persists across sessions.</p>' +

        '<p><strong>Step 1: Create the project structure</strong></p>' +
        '<pre><code>mkdir -p state_scopes_lab\ncd state_scopes_lab</code></pre>' +

        '<p><strong>Step 2: Create the writer agent (agent_writer.py)</strong></p>' +
        '<pre><code>import google.adk as adk\nfrom google.adk.agents import SequentialAgent, LlmAgent\nfrom google.adk.events import EventActions\n\ndef set_all_scopes(context):\n    \"\"\"Tool that writes a value at every scope level.\"\"\"\n    context.state[\'session_var\'] = \'I am session-scoped\'\n    context.state[\'temp:temp_var\'] = \'I am temp-scoped\'\n    context.state[\'user:user_var\'] = \'I am user-scoped\'\n    context.state[\'app:app_var\'] = \'I am app-scoped\'\n    return \'All four scopes written successfully.\'\n\nwriter = LlmAgent(\n    name=\'scope_writer\',\n    model=\'gemini-2.5-flash\',\n    instruction=\'Call the set_all_scopes tool immediately.\',\n    tools=[set_all_scopes],\n    output_key=\'writer_result\'\n)</code></pre>' +

        '<p><strong>Step 3: Create the reader agent (agent_reader.py)</strong></p>' +
        '<pre><code>def read_all_scopes(context):\n    \"\"\"Tool that reads all four scope levels and reports.\"\"\"\n    results = []\n    for key in [\'session_var\', \'temp:temp_var\', \'user:user_var\', \'app:app_var\']:\n        value = context.state.get(key, \'NOT FOUND\')\n        results.append(f\'{key} = {value}\')\n    return \'\\n\'.join(results)\n\nreader = LlmAgent(\n    name=\'scope_reader\',\n    model=\'gemini-2.5-flash\',\n    instruction=\'Call the read_all_scopes tool and report exactly what you find.\',\n    tools=[read_all_scopes],\n    output_key=\'reader_result\'\n)</code></pre>' +

        '<p><strong>Step 4: Create the pipeline (main.py)</strong></p>' +
        '<pre><code>from google.adk.agents import SequentialAgent\nfrom google.adk.runners import Runner\nfrom google.adk.sessions import InMemorySessionService\nfrom agent_writer import writer\nfrom agent_reader import reader\nimport asyncio\n\npipeline = SequentialAgent(\n    name=\'scope_test_pipeline\',\n    sub_agents=[writer, reader]\n)\n\nasync def main():\n    session_service = InMemorySessionService()\n    runner = Runner(agent=pipeline, app_name=\'scope_lab\', session_service=session_service)\n\n    # Session 1: Write + Read in same session\n    session1 = await session_service.create_session(\n        app_name=\'scope_lab\', user_id=\'user1\'\n    )\n    print(\'=== Session 1: Write + Read ===\")\n    async for event in runner.run_async(\n        user_id=\'user1\', session_id=session1.id,\n        new_message=adk.types.Content(parts=[adk.types.Part(text=\'Go\')])\n    ):\n        if event.content and event.content.parts:\n            print(f\'[{event.author}]: {event.content.parts[0].text}\')\n\n    # Session 2: New session, same user -- only read\n    session2 = await session_service.create_session(\n        app_name=\'scope_lab\', user_id=\'user1\'\n    )\n    reader_only = Runner(agent=reader, app_name=\'scope_lab\', session_service=session_service)\n    print(\'\\n=== Session 2: Read only (new session, same user) ===\')\n    async for event in reader_only.run_async(\n        user_id=\'user1\', session_id=session2.id,\n        new_message=adk.types.Content(parts=[adk.types.Part(text=\'Read scopes\')])\n    ):\n        if event.content and event.content.parts:\n            print(f\'[{event.author}]: {event.content.parts[0].text}\')\n\nasyncio.run(main())</code></pre>' +

        '<p><strong>Step 5: Run and observe</strong></p>' +
        '<pre><code>python main.py</code></pre>' +

        '<p><strong>Expected results:</strong></p>' +
        '<ul>' +
        '<li>Session 1 (same session): All four scopes should be readable</li>' +
        '<li>Session 2 (new session, InMemorySessionService): session_var = NOT FOUND, temp:temp_var = NOT FOUND. With InMemorySessionService, user: and app: behavior depends on implementation -- they may also be NOT FOUND since InMemorySessionService does not implement cross-session persistence.</li>' +
        '<li>Key insight: To see user: and app: persist across sessions, you need DatabaseSessionService or Vertex AI.</li>' +
        '</ul>' +

        '<p><strong>Step 6: Document your findings</strong></p>' +
        '<p>Record which values persisted and which did not. This is the empirical foundation for understanding ADK state lifetime.</p>'
    },
    {
      id: 'output-key',
      title: 'output_key Data Flow',
      content:
        '<p><strong>output_key</strong> is ADK\'s primary mechanism for passing data between agents in a SequentialAgent pipeline. It is deceptively simple: you set a string property on an agent, and ADK automatically saves the agent\'s final text response into session state under that key. Downstream agents reference it in their instruction using <code>{key_name}</code> template syntax. But the simplicity hides several sharp edges.</p>' +

        '<h3>How output_key Works</h3>' +
        '<p>When an LlmAgent has <code>output_key="research_findings"</code>, ADK intercepts the agent\'s final response and writes it to <code>session.state["research_findings"]</code>. Any subsequent agent in the pipeline can reference this value using <code>{research_findings}</code> in its instruction string. ADK performs simple string substitution before sending the instruction to the LLM.</p>' +
        '<pre><code>researcher = LlmAgent(\n    name=\'researcher\',\n    model=\'gemini-2.5-flash\',\n    instruction=\'Research the topic: {topic}\',\n    output_key=\'research_findings\'  # saves response to state\n)\n\nwriter = LlmAgent(\n    name=\'writer\',\n    model=\'gemini-2.5-flash\',\n    instruction=\'Write an article based on: {research_findings}\',  # reads from state\n    output_key=\'draft_article\'\n)\n\neditor = LlmAgent(\n    name=\'editor\',\n    model=\'gemini-2.5-flash\',\n    instruction=\'Edit this draft for clarity: {draft_article}\',\n    output_key=\'final_article\'\n)\n\npipeline = SequentialAgent(\n    name=\'content_pipeline\',\n    sub_agents=[researcher, writer, editor]\n)</code></pre>' +

        '<h3>String-Based, Untyped, Unvalidated</h3>' +
        '<p>This is the critical design choice to understand: output_key data flow is entirely string-based. There is no schema, no type checking, no validation that the downstream agent actually references the correct key. Contrast this with typed Task objects in frameworks like CrewAI, where inputs and outputs have defined schemas.</p>' +
        '<p>The implications are significant:</p>' +
        '<ul>' +
        '<li><strong>No compile-time checking</strong> -- a misspelled variable reference is only discovered at runtime, and even then it fails silently</li>' +
        '<li><strong>No structured data</strong> -- if you need the downstream agent to receive JSON, you must prompt the upstream agent to output JSON and hope it complies</li>' +
        '<li><strong>No size limits</strong> -- if an agent produces a 50,000-token response, the entire string is stored in state and injected into the next agent\'s instruction, potentially exceeding context windows</li>' +
        '<li><strong>No data contracts</strong> -- there is no way to specify what shape of data agent B expects from agent A</li>' +
        '</ul>' +

        '<h3>Silent Failure on Misspelled Variables</h3>' +
        '<p>This is the sharpest edge. If you write <code>{reserach_findings}</code> (note the typo) in a downstream instruction, ADK does not throw an error. It does not warn. The literal text <code>{reserach_findings}</code> is passed to the LLM as part of the instruction. The LLM sees a string with curly braces and may interpret it in unpredictable ways -- or simply ignore it.</p>' +
        '<pre><code># This will SILENTLY FAIL -- no error, no warning\neditor = LlmAgent(\n    name=\'editor\',\n    model=\'gemini-2.5-flash\',\n    instruction=\'Edit this draft: {reserach_findings}\',  # typo!\n    output_key=\'final_article\'\n)\n# The editor receives the literal text \"{reserach_findings}\" in its instruction.\n# It has no idea this was supposed to be substituted.</code></pre>' +

        '<h3>The Optional Variable Suffix</h3>' +
        '<p>ADK supports a <code>?</code> suffix for optional variables: <code>{var_name?}</code>. When the variable is not found in state, the placeholder is silently removed (replaced with empty string) instead of being left as literal text. This is useful for agents that may or may not have prior context, but it also masks configuration errors.</p>' +
        '<pre><code># Optional -- silently removed if not found\ninstruction=\'Consider previous research: {prior_work?}\\nNow research: {topic}\'\n\n# Required -- left as literal text if not found (silent bug)\ninstruction=\'Based on research: {research_findings}\\nWrite the article.\'</code></pre>' +

        '<h3>Memory Implications</h3>' +
        '<p>Every output_key value stays in session state for the lifetime of the session. In a pipeline with 10 agents, each producing multi-paragraph responses, the session state accumulates all of them. When these values are injected into downstream instructions, they expand the prompt, consuming more tokens and increasing cost. There is no automatic cleanup, no TTL, no size warning.</p>',

      summary: 'output_key is string-based, untyped data passing via session state. Downstream agents reference values with {key_name} in their instruction. Misspelled references fail silently. No validation, no contracts, no size limits. Use {var?} for optional variables that should silently disappear when missing.',

      mentalModel: 'output_key is like a relay race baton -- each agent runs with it, then sets it down for the next. But unlike a real baton, nobody checks if the next runner actually picks it up. And the baton is just a string -- no label, no schema, no guarantee of what is inside.',

      mistakes: [
        'Misspelling the output_key reference in a downstream instruction -- fails silently with no validation or warning. The LLM sees the literal placeholder text.',
        'Relying on output_key for structured data -- it is raw text only. There is no JSON parsing, no schema enforcement. If you need structure, you must prompt for it and validate manually.',
        'Creating circular output_key references -- agent A reads from B\'s key while B reads from A\'s key. This creates undefined behavior in sequential pipelines.',
        'Not using the ? suffix for optional variables -- {var} leaves the literal placeholder when missing, while {var?} silently removes it. Choose deliberately.'
      ],

      exercise:
        '<p><strong>Goal:</strong> Build a three-agent pipeline, trace data flow, and observe silent failure on misspelled references.</p>' +

        '<p><strong>Step 1: Create the pipeline (output_key_lab.py)</strong></p>' +
        '<pre><code>import google.adk as adk\nfrom google.adk.agents import SequentialAgent, LlmAgent\nfrom google.adk.runners import Runner\nfrom google.adk.sessions import InMemorySessionService\nimport asyncio\n\nresearcher = LlmAgent(\n    name=\'researcher\',\n    model=\'gemini-2.5-flash\',\n    instruction=\'Research the benefits of async programming in Python. Be concise -- 3 bullet points max.\',\n    output_key=\'research_findings\'\n)\n\nwriter = LlmAgent(\n    name=\'writer\',\n    model=\'gemini-2.5-flash\',\n    instruction=\'Write a short paragraph based on these findings: {research_findings}\',\n    output_key=\'draft_article\'\n)\n\neditor = LlmAgent(\n    name=\'editor\',\n    model=\'gemini-2.5-flash\',\n    instruction=\'Polish this draft for publication: {draft_article}\',\n    output_key=\'final_article\'\n)\n\npipeline = SequentialAgent(\n    name=\'content_pipeline\',\n    sub_agents=[researcher, writer, editor]\n)</code></pre>' +

        '<p><strong>Step 2: Run and trace state</strong></p>' +
        '<pre><code>async def main():\n    session_service = InMemorySessionService()\n    runner = Runner(agent=pipeline, app_name=\'output_key_lab\', session_service=session_service)\n    session = await session_service.create_session(app_name=\'output_key_lab\', user_id=\'user1\')\n\n    async for event in runner.run_async(\n        user_id=\'user1\', session_id=session.id,\n        new_message=adk.types.Content(parts=[adk.types.Part(text=\'Go\')])\n    ):\n        if event.content and event.content.parts:\n            print(f\'[{event.author}]: {event.content.parts[0].text[:200]}...\')\n\n    # Inspect state after pipeline completes\n    final_session = await session_service.get_session(\n        app_name=\'output_key_lab\', user_id=\'user1\', session_id=session.id\n    )\n    print(\'\\n=== State After Pipeline ===\')\n    for key in [\'research_findings\', \'draft_article\', \'final_article\']:\n        val = final_session.state.get(key, \'NOT FOUND\')\n        print(f\'{key}: {val[:100]}...\')\n\nasyncio.run(main())</code></pre>' +

        '<p><strong>Step 3: Break it with a typo</strong></p>' +
        '<pre><code># Change the editor\'s instruction to include a typo:\neditor_broken = LlmAgent(\n    name=\'editor\',\n    model=\'gemini-2.5-flash\',\n    instruction=\'Polish this draft for publication: {darft_article}\',  # typo!\n    output_key=\'final_article\'\n)\n\n# Rebuild pipeline with broken editor and run again.\n# Observe: no error. The editor receives the literal text \"{darft_article}\"\n# and writes something based on that nonsensical input.</code></pre>' +

        '<p><strong>Step 4: Test optional variables</strong></p>' +
        '<pre><code># Add a ? suffix to make the variable optional:\neditor_optional = LlmAgent(\n    name=\'editor\',\n    model=\'gemini-2.5-flash\',\n    instruction=\'Consider this context: {prior_reviews?}\\nPolish this draft: {draft_article}\',\n    output_key=\'final_article\'\n)\n# {prior_reviews?} silently disappears. {draft_article} is substituted normally.</code></pre>' +

        '<p><strong>Step 5: Document findings</strong></p>' +
        '<ul>' +
        '<li>Did each agent\'s output appear in state under the correct key?</li>' +
        '<li>What happened when you misspelled the variable? Was there any error or warning?</li>' +
        '<li>How did the editor\'s output change between the correct and broken versions?</li>' +
        '<li>What is the total size of state after the pipeline completes?</li>' +
        '</ul>',

      postEvidence: 'ADK\'s inter-agent data flow is string-based and unvalidated. A misspelled variable reference fails silently. In a fleet of 50 agents, this kind of silent failure compounds -- there is no framework-level data contract between agents.'
    }
  ]
});
