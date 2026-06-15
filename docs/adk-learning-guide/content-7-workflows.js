window.COURSE_SECTIONS = window.COURSE_SECTIONS || [];
window.COURSE_SECTIONS.push({
  id: 'workflows',
  title: '7. ADK 2.0 Workflows',
  topics: [
    {
      id: 'graph-basics',
      title: 'Graph Basics',
      content:
        '<h3>From Template Agents to Graphs</h3>' +
        '<p>ADK 2.0 introduced <code>Workflow</code> -- a graph-based execution engine that supersedes the template agents (Sequential/Parallel/Loop). Instead of nesting agent constructors to express execution order, you define a graph with explicit edges. The graph is the execution plan, visible at definition time, not buried inside nested constructors.</p>' +

        '<h3>Defining a Graph</h3>' +
        '<p>The graph is defined with an edge list. Each edge connects two nodes (agents), and the special string <code>"START"</code> marks the entry point. The syntax is:</p>' +
        '<pre><code>from google.adk.agents import Agent\nfrom google.adk.agents.workflow import Workflow\n\nagent_a = Agent(\n    name=\'agent_a\',\n    model=\'gemini-2.5-flash\',\n    instruction=\'Generate three product name ideas.\',\n    output_key=\'ideas\'\n)\n\nagent_b = Agent(\n    name=\'agent_b\',\n    model=\'gemini-2.5-flash\',\n    instruction=\'Read the ideas from state key "ideas" and pick the best one. Explain your reasoning.\',\n    output_key=\'winner\'\n)\n\nworkflow = Workflow(\n    name=\'product_pipeline\',\n    edges=[\n        ("START", agent_a, agent_b)\n    ]\n)</code></pre>' +
        '<p>This means: start with agent_a, then run agent_b. The edge <code>("START", agent_a, agent_b)</code> encodes a linear sequence: START &rarr; agent_a &rarr; agent_b. Each node is an Agent that executes and passes data via <code>output_key</code> to session state.</p>' +

        '<h3>How the Graph Engine Works</h3>' +
        '<p>The graph engine handles three responsibilities:</p>' +
        '<ul>' +
        '<li><strong>Execution ordering</strong> -- Follows the edges to determine which agent runs next. No agent runs until all its incoming edges have been satisfied.</li>' +
        '<li><strong>State management</strong> -- Each agent reads from and writes to session state via <code>output_key</code>. The graph does not introduce a separate data channel -- it uses the same state system as template agents.</li>' +
        '<li><strong>Error propagation</strong> -- If a node fails, the graph engine can propagate the error downstream or handle it with retry logic.</li>' +
        '</ul>' +

        '<h3>Graph Features</h3>' +
        '<p>Beyond simple linear flows, the graph engine supports:</p>' +
        '<ul>' +
        '<li><strong>Routing</strong> -- Conditional edges that select the next node based on state values. "If state[\'quality\'] == \'low\', go to reviser; otherwise go to publisher."</li>' +
        '<li><strong>Fan-out / Fan-in</strong> -- Parallel branches that split and merge. Covered in detail in the next topic.</li>' +
        '<li><strong>Loops</strong> -- Edges that cycle back to a previous node. Unlike LoopAgent, there is no built-in <code>max_iterations</code> -- you must add your own loop-breaking logic.</li>' +
        '<li><strong>Retry</strong> -- Re-execute failed nodes. The graph engine can detect node failure and re-run the same agent.</li>' +
        '<li><strong>Dynamic nodes</strong> -- Add agents at runtime based on conditions. The graph structure is not fully static.</li>' +
        '<li><strong>Human-in-the-loop</strong> -- Pause the graph for human input before continuing to the next node.</li>' +
        '</ul>' +

        '<h3>Why Graphs Matter</h3>' +
        '<p>The key advantage of graph-based orchestration is <strong>explicitness</strong>. With template agents, you express a pipeline by nesting constructors -- a SequentialAgent containing a ParallelAgent containing sub-agents. The execution plan is implicit in the nesting structure. With a graph, the execution plan is the edge list -- you can read it, serialize it, visualize it, and reason about it without running the code.</p>' +
        '<p>For simple linear flows, graphs and template agents produce identical behavior. The graph shines when orchestration becomes complex: conditional routing, error recovery, mixed parallel/sequential flows, and dynamic agent addition. These patterns require deeply nested template agents but are a flat edge list in a graph.</p>',

      summary: 'ADK 2.0 Workflow is a graph-based execution engine defined with edges. The special string "START" marks the entry point. Each node is an Agent that passes data via output_key. The graph engine handles execution ordering, state management, and error propagation. Features include routing, fan-out/fan-in, loops, retry, and human-in-the-loop.',

      mentalModel: 'Workflow graphs are like flowcharts -- each box is an agent, each arrow is an edge. The graph engine follows the arrows, executing agents in order. Unlike a flowchart on paper, this one actually runs.',

      mistakes: [
        'Forgetting "START" as the entry point -- the graph will not know where to begin. Every graph needs at least one edge originating from "START".',
        'Creating disconnected nodes -- agents that no edge reaches will never execute. If an agent appears in no edge, it is invisible to the graph engine.',
        'Assuming graph execution is fundamentally different from template agents -- for simple linear flows, they produce the same result. The graph is a different syntax, not a different engine.',
        'Not using output_key for data flow between nodes -- the graph handles execution order but not data transfer. Without output_key, downstream agents cannot read upstream results from state.'
      ],

      exercise:
        '<p><strong>Step 1: Create the project structure</strong></p>' +
        '<pre><code>mkdir -p adk_workflows/product_pipeline</code></pre>' +

        '<p><strong>Step 2: Define a two-node graph</strong></p>' +
        '<p>Create <code>adk_workflows/product_pipeline/__init__.py</code>:</p>' +
        '<pre><code>from google.adk.agents import Agent\nfrom google.adk.agents.workflow import Workflow\n\ngenerate = Agent(\n    name=\'generate\',\n    model=\'gemini-2.5-flash\',\n    instruction=(\n        \'Generate 5 creative product names for a smart water bottle \'\n        \'that tracks hydration. List them numbered 1-5.\'\n    ),\n    output_key=\'product_names\'\n)\n\nevaluate = Agent(\n    name=\'evaluate\',\n    model=\'gemini-2.5-flash\',\n    instruction=(\n        \'Read the product names from state key "product_names". \'\n        \'Evaluate each name on memorability, brand potential, and clarity. \'\n        \'Pick the best one and explain why.\'\n    ),\n    output_key=\'winner\'\n)\n\nroot_agent = Workflow(\n    name=\'product_pipeline\',\n    edges=[\n        ("START", generate, evaluate)\n    ]\n)</code></pre>' +

        '<p><strong>Step 3: Run the workflow</strong></p>' +
        '<pre><code>cd adk_workflows\nadk web .</code></pre>' +
        '<p>Send any message (e.g., "Go") to trigger the pipeline. Observe: the generate agent runs first, its output is saved to state["product_names"], then the evaluate agent reads it and picks a winner.</p>' +

        '<p><strong>Step 4: Inspect the execution trace</strong></p>' +
        '<p>Switch to the Trace tab. Note the two spans -- one for generate, one for evaluate. Check the ordering: generate completes before evaluate starts. Check session state: both "product_names" and "winner" should be populated.</p>' +

        '<p><strong>Step 5: Build the same pipeline with SequentialAgent</strong></p>' +
        '<p>Create a second agent package <code>adk_workflows/product_seq/__init__.py</code>:</p>' +
        '<pre><code>from google.adk.agents import Agent, SequentialAgent\n\ngenerate = Agent(\n    name=\'generate\',\n    model=\'gemini-2.5-flash\',\n    instruction=(\n        \'Generate 5 creative product names for a smart water bottle \'\n        \'that tracks hydration. List them numbered 1-5.\'\n    ),\n    output_key=\'product_names\'\n)\n\nevaluate = Agent(\n    name=\'evaluate\',\n    model=\'gemini-2.5-flash\',\n    instruction=(\n        \'Read the product names from state key "product_names". \'\n        \'Evaluate each name on memorability, brand potential, and clarity. \'\n        \'Pick the best one and explain why.\'\n    ),\n    output_key=\'winner\'\n)\n\nroot_agent = SequentialAgent(\n    name=\'product_seq\',\n    sub_agents=[generate, evaluate]\n)</code></pre>' +

        '<p><strong>Step 6: Compare the two approaches</strong></p>' +
        '<p>Run both pipelines. Compare:</p>' +
        '<ul>' +
        '<li>Are the execution traces identical? (They should be very similar for this linear flow.)</li>' +
        '<li>Does state flow the same way? (Yes -- both use output_key.)</li>' +
        '<li>Which is more readable? (For two agents, SequentialAgent is simpler. For 10+ agents with branches, the graph wins.)</li>' +
        '</ul>'
    },
    {
      id: 'fan-out-fan-in',
      title: 'Fan-Out and Fan-In',
      content:
        '<h3>Parallel Branches in Graphs</h3>' +
        '<p>Fan-out launches multiple agents in parallel from a single predecessor. Fan-in waits for all parallel branches to complete before continuing to the next node. This is the graph equivalent of ParallelAgent, but with a cleaner syntax for merging results.</p>' +

        '<h3>Fan-Out Syntax</h3>' +
        '<p>To fan out from a single agent to multiple agents, use a list as the target:</p>' +
        '<pre><code>edges=[\n    ("START", agent_gen, [eval_a, eval_b, eval_c])\n]</code></pre>' +
        '<p>This means: START &rarr; agent_gen, then agent_gen fans out to eval_a, eval_b, and eval_c simultaneously. All three evaluators run in parallel.</p>' +

        '<h3>Fan-In Syntax</h3>' +
        '<p>To merge parallel branches back to a single agent:</p>' +
        '<pre><code>edges=[\n    ("START", agent_gen, [eval_a, eval_b, eval_c]),\n    ([eval_a, eval_b, eval_c], aggregator)\n]</code></pre>' +
        '<p>The second edge uses a list as the source: all three evaluators must complete before the aggregator runs. The aggregator can then read each evaluator\'s output from state via their respective <code>output_key</code> values.</p>' +

        '<h3>Concurrency Behavior</h3>' +
        '<p>Each parallel branch runs independently -- same as ParallelAgent. There is <strong>no concurrency cap</strong>. If you fan out to 10 agents, all 10 fire simultaneously. No throttling, no staggering, no rate limit awareness. The same concurrency question from ParallelAgent applies: what happens when all 10 agents hit the Gemini API at the same time?</p>' +
        '<p>Add <code>before_model_callback</code> to each branch to verify timing. You will see that all branches fire within milliseconds of each other. Fan-out with many branches has the same rate limit risk as ParallelAgent -- the graph engine handles ordering and merging but not resource contention.</p>' +

        '<h3>Data Flow in Fan-Out/Fan-In</h3>' +
        '<p>Each parallel branch must write to a <strong>unique</strong> <code>output_key</code>. If two branches share the same output_key, the last one to complete overwrites the other -- a race condition identical to the shared state problem in ParallelAgent. The aggregator reads each branch\'s output from its distinct state key:</p>' +
        '<pre><code>eval_a = Agent(name=\'eval_quality\', ..., output_key=\'score_quality\')\neval_b = Agent(name=\'eval_market\', ..., output_key=\'score_market\')\neval_c = Agent(name=\'eval_brand\', ..., output_key=\'score_brand\')\n\naggregator = Agent(\n    name=\'aggregator\',\n    model=\'gemini-2.5-flash\',\n    instruction=(\n        \'Read the three evaluation scores from state: \'\n        \'score_quality, score_market, score_brand. \'\n        \'Synthesize them and pick the best product name.\'\n    ),\n    output_key=\'final_decision\'\n)</code></pre>' +

        '<h3>Fan-In Blocking Behavior</h3>' +
        '<p>Fan-in is a blocking gate: the aggregator does not run until ALL branches have completed. If one branch fails, the fan-in blocks indefinitely (or until the invocation times out). There is no partial fan-in -- you cannot proceed with 2 out of 3 results. This means the total time for the fan-out/fan-in pattern is the time of the <strong>slowest</strong> branch, not the average.</p>',

      summary: 'Fan-out uses a list target in edges to launch parallel branches. Fan-in uses a list source to wait for all branches before continuing. All branches fire simultaneously with no concurrency cap. Each branch needs a unique output_key to avoid race conditions. Fan-in blocks until ALL branches complete -- one slow or failed branch blocks the whole pipeline.',

      mentalModel: 'Fan-out is like a manager delegating to three team members simultaneously, then collecting all their reports before making a decision. The manager (aggregator) waits for the slowest team member -- the total time is the max of all branches, not the sum.',

      mistakes: [
        'Not giving each parallel branch a unique output_key -- they will overwrite each other in a non-deterministic race condition.',
        'Assuming fan-in will work if one branch fails -- it blocks. All branches must complete before the aggregator runs. There is no partial fan-in.',
        'Creating too many fan-out branches without considering rate limits -- same problem as ParallelAgent. Ten branches means ten simultaneous API calls.',
        'Not using the aggregator pattern -- fan-out without fan-in leaves results scattered across multiple state keys with no synthesis. Always pair fan-out with a downstream aggregator.'
      ],

      exercise:
        '<p><strong>Step 1: Create the evaluation pipeline</strong></p>' +
        '<p>Create <code>adk_workflows/eval_pipeline/__init__.py</code>:</p>' +
        '<pre><code>import time\nfrom google.adk.agents import Agent\nfrom google.adk.agents.workflow import Workflow\nfrom google.genai.types import Content, Part\n\n\ndef log_timestamp(callback_context, llm_request):\n    agent_name = callback_context.agent_name\n    ts = time.time()\n    print(f"[{ts:.3f}] {agent_name} calling LLM")\n    callback_context.state[f\'temp:ts_{agent_name}\'] = ts\n    return None\n\n\ngenerator = Agent(\n    name=\'generator\',\n    model=\'gemini-2.5-flash\',\n    instruction=(\n        \'Generate 3 product names for an AI-powered coffee maker. \'\n        \'List them numbered 1-3 with a one-line description each.\'\n    ),\n    output_key=\'product_names\',\n    before_model_callback=log_timestamp\n)\n\neval_quality = Agent(\n    name=\'eval_quality\',\n    model=\'gemini-2.5-flash\',\n    instruction=(\n        \'Read the product names from state key "product_names". \'\n        \'Rate each name 1-10 on quality and memorability. Be specific.\'\n    ),\n    output_key=\'score_quality\',\n    before_model_callback=log_timestamp\n)\n\neval_market = Agent(\n    name=\'eval_market\',\n    model=\'gemini-2.5-flash\',\n    instruction=(\n        \'Read the product names from state key "product_names". \'\n        \'Rate each name 1-10 on market fit and target audience appeal.\'\n    ),\n    output_key=\'score_market\',\n    before_model_callback=log_timestamp\n)\n\neval_brand = Agent(\n    name=\'eval_brand\',\n    model=\'gemini-2.5-flash\',\n    instruction=(\n        \'Read the product names from state key "product_names". \'\n        \'Rate each name 1-10 on brand potential, domain availability, \'\n        \'and trademark risk.\'\n    ),\n    output_key=\'score_brand\',\n    before_model_callback=log_timestamp\n)\n\naggregator = Agent(\n    name=\'aggregator\',\n    model=\'gemini-2.5-flash\',\n    instruction=(\n        \'Read all three evaluation scores from state: \'\n        \'score_quality, score_market, score_brand. \'\n        \'Synthesize them into a final ranking. Pick the winner \'\n        \'and explain your reasoning.\'\n    ),\n    output_key=\'final_decision\',\n    before_model_callback=log_timestamp\n)\n\nroot_agent = Workflow(\n    name=\'eval_pipeline\',\n    edges=[\n        ("START", generator, [eval_quality, eval_market, eval_brand]),\n        ([eval_quality, eval_market, eval_brand], aggregator)\n    ]\n)</code></pre>' +

        '<p><strong>Step 2: Run and check timestamps</strong></p>' +
        '<pre><code>cd adk_workflows\nadk web .</code></pre>' +
        '<p>Select "eval_pipeline" and send any message. Watch the terminal output. The three evaluator timestamps should be nearly identical -- they fire simultaneously.</p>' +

        '<p><strong>Step 3: Verify state keys</strong></p>' +
        '<p>Check session state in the web UI. You should see five keys: product_names, score_quality, score_market, score_brand, and final_decision. Each evaluator wrote to its own key; the aggregator read all three.</p>' +

        '<p><strong>Step 4: Test with 10 evaluators</strong></p>' +
        '<p>Add 7 more evaluator agents (eval_tone, eval_length, eval_international, etc.) to the fan-out. Run again and observe:</p>' +
        '<ul>' +
        '<li>Do all 10 fire simultaneously? (Yes.)</li>' +
        '<li>Do you hit rate limits? (Likely, depending on your quota.)</li>' +
        '<li>What happens to the aggregator if one evaluator fails? (It blocks -- fan-in waits for all.)</li>' +
        '</ul>' +

        '<p><strong>Step 5: Document findings</strong></p>' +
        '<p>Create a comparison table:</p>' +
        '<pre><code>Metric              | 3 Evaluators | 10 Evaluators\n--------------------|-------------|---------------\nSimultaneous calls  | 3           | 10\nRate limit errors   | None        | ???\nTotal wall-clock    | ~3s         | ???\nSuccess rate        | 100%        | ???</code></pre>',

      postEvidence: 'Fan-out in Workflow graphs has the same concurrency problem as ParallelAgent -- all branches fire simultaneously with no throttling. The graph engine handles ordering and merging but not resource contention.'
    },
    {
      id: 'graphs-vs-templates',
      title: 'Graphs vs Template Agents',
      content:
        '<h3>Two Syntaxes, Same Engine</h3>' +
        '<p>ADK 2.0 positions Workflow graphs as the successor to Sequential/Parallel/LoopAgent. But the template agents still work and are <strong>not deprecated</strong>. Both are valid ways to express multi-agent orchestration. The question is not "which is better" but "which is clearer for this specific pipeline."</p>' +

        '<h3>Feature Comparison</h3>' +
        '<table>' +
        '<tr><th>Feature</th><th>Template Agents</th><th>Workflow Graphs</th></tr>' +
        '<tr><td>Linear sequence</td><td>SequentialAgent([a, b, c])</td><td>edges=[("START", a, b, c)]</td></tr>' +
        '<tr><td>Parallel execution</td><td>ParallelAgent([a, b, c])</td><td>edges=[("START", [a, b, c])]</td></tr>' +
        '<tr><td>Fan-in (merge)</td><td>Nested Sequential + Parallel</td><td>edges=[([a, b, c], aggregator)]</td></tr>' +
        '<tr><td>Loops</td><td>LoopAgent(max_iterations=N)</td><td>Cyclic edges + manual break logic</td></tr>' +
        '<tr><td>Conditional routing</td><td>Manual in callbacks</td><td>Conditional edges based on state</td></tr>' +
        '<tr><td>Error handling</td><td>Sub-agent exceptions</td><td>Node-level retry, error edges</td></tr>' +
        '<tr><td>Readability at scale</td><td>Deeply nested constructors</td><td>Flat edge list</td></tr>' +
        '</table>' +

        '<h3>Where Each Shines</h3>' +
        '<p><strong>Template agents win for simple patterns:</strong> A SequentialAgent with 3 sub-agents is more readable than a 3-node graph. A ParallelAgent with 2 sub-agents is clearer than fan-out syntax. If your pipeline is simple, template agents are less code and easier to understand.</p>' +
        '<p><strong>Graphs win for complex orchestration:</strong> When you have conditional branches, error recovery paths, mixed parallel/sequential flows, or more than 5-6 agents, the edge list is dramatically more readable than nested constructors. A 10-agent pipeline with conditional routing is a readable edge list in a graph but an unreadable nest of template agents.</p>' +

        '<h3>Loop Comparison: A Critical Difference</h3>' +
        '<p>LoopAgent provides <code>max_iterations</code> and an <code>escalation</code> mechanism -- if the loop does not converge, it escalates to a parent agent. Cyclic graphs do not have this built in. You must implement loop-breaking logic yourself: a callback that checks state and removes the cyclic edge, or a routing edge that conditionally exits the loop. This makes LoopAgent strictly safer for loops -- it has a built-in circuit breaker that graphs lack.</p>' +

        '<h3>The Shared Gap</h3>' +
        '<p>Neither template agents nor workflow graphs solve the scheduling problem. Both lack:</p>' +
        '<ul>' +
        '<li><strong>Concurrency limits</strong> -- ParallelAgent and fan-out both fire all branches simultaneously with no cap.</li>' +
        '<li><strong>Cost tracking</strong> -- Neither tracks token spend or model cost. The Trace tab shows per-turn tokens but neither orchestrator aggregates them.</li>' +
        '<li><strong>Rate limit awareness</strong> -- No automatic retry, backoff, or request queuing on 429 errors.</li>' +
        '<li><strong>Priority-based execution</strong> -- All agents are equal. There is no way to say "this agent is critical, run it first."</li>' +
        '<li><strong>Cross-agent resource sharing</strong> -- Multiple agents sharing the same API quota have no coordination mechanism.</li>' +
        '</ul>' +
        '<p>The orchestration layer is well-built. The scheduling layer is absent. This is true for both syntaxes.</p>',

      summary: 'Template agents and graphs are two syntaxes for the same orchestration engine. Templates win for simple patterns (fewer than 5 agents, no branching). Graphs win for complex orchestration (conditional routing, error recovery, mixed flows). LoopAgent is safer than cyclic graphs because it has max_iterations. Neither has scheduling, cost tracking, or concurrency control.',

      mentalModel: 'Template agents are LEGO -- pre-built blocks you snap together. Workflow graphs are a circuit board -- you wire components with explicit connections. Both build the same thing, but the circuit board shows you the full picture at a glance.',

      mistakes: [
        'Rewriting working template agent code to use graphs just because graphs are newer -- unnecessary churn for simple pipelines. If SequentialAgent works for your use case, keep it.',
        'Assuming graphs solve problems that template agents do not -- the scheduling gap exists in both. Graphs add expressiveness, not resource management.',
        'Building complex graphs without documentation -- the edge list becomes unreadable quickly. Add comments explaining each edge, especially conditional ones.',
        'Not testing error propagation in graphs -- a failing node may behave differently than a failing sub-agent in a template. Test failure modes explicitly in both syntaxes.'
      ],

      exercise:
        '<p><strong>Step 1: Build the pipeline with a Workflow graph</strong></p>' +
        '<p>Create <code>adk_workflows/compare_graph/__init__.py</code>:</p>' +
        '<pre><code>from google.adk.agents import Agent\nfrom google.adk.agents.workflow import Workflow\n\nresearcher = Agent(\n    name=\'researcher\',\n    model=\'gemini-2.5-flash\',\n    instruction=\'Research the pros and cons of remote work.\',\n    output_key=\'research\'\n)\n\noptimist = Agent(\n    name=\'optimist\',\n    model=\'gemini-2.5-flash\',\n    instruction=\'Read state key "research". Write an optimistic summary emphasizing the benefits.\',\n    output_key=\'optimist_view\'\n)\n\nskeptic = Agent(\n    name=\'skeptic\',\n    model=\'gemini-2.5-flash\',\n    instruction=\'Read state key "research". Write a skeptical summary emphasizing the risks.\',\n    output_key=\'skeptic_view\'\n)\n\nsynthesizer = Agent(\n    name=\'synthesizer\',\n    model=\'gemini-2.5-flash\',\n    instruction=(\n        \'Read state keys "optimist_view" and "skeptic_view". \'\n        \'Synthesize both perspectives into a balanced conclusion.\'\n    ),\n    output_key=\'synthesis\'\n)\n\nroot_agent = Workflow(\n    name=\'compare_graph\',\n    edges=[\n        ("START", researcher, [optimist, skeptic]),\n        ([optimist, skeptic], synthesizer)\n    ]\n)</code></pre>' +

        '<p><strong>Step 2: Build the same pipeline with template agents</strong></p>' +
        '<p>Create <code>adk_workflows/compare_template/__init__.py</code>:</p>' +
        '<pre><code>from google.adk.agents import Agent, SequentialAgent, ParallelAgent\n\nresearcher = Agent(\n    name=\'researcher\',\n    model=\'gemini-2.5-flash\',\n    instruction=\'Research the pros and cons of remote work.\',\n    output_key=\'research\'\n)\n\noptimist = Agent(\n    name=\'optimist\',\n    model=\'gemini-2.5-flash\',\n    instruction=\'Read state key "research". Write an optimistic summary emphasizing the benefits.\',\n    output_key=\'optimist_view\'\n)\n\nskeptic = Agent(\n    name=\'skeptic\',\n    model=\'gemini-2.5-flash\',\n    instruction=\'Read state key "research". Write a skeptical summary emphasizing the risks.\',\n    output_key=\'skeptic_view\'\n)\n\nsynthesizer = Agent(\n    name=\'synthesizer\',\n    model=\'gemini-2.5-flash\',\n    instruction=(\n        \'Read state keys "optimist_view" and "skeptic_view". \'\n        \'Synthesize both perspectives into a balanced conclusion.\'\n    ),\n    output_key=\'synthesis\'\n)\n\nparallel_eval = ParallelAgent(\n    name=\'parallel_eval\',\n    sub_agents=[optimist, skeptic]\n)\n\nroot_agent = SequentialAgent(\n    name=\'compare_template\',\n    sub_agents=[researcher, parallel_eval, synthesizer]\n)</code></pre>' +

        '<p><strong>Step 3: Run both and compare</strong></p>' +
        '<pre><code>cd adk_workflows\nadk web .</code></pre>' +
        '<p>Run each pipeline with the same input. Compare:</p>' +
        '<ul>' +
        '<li><strong>Code verbosity:</strong> The graph version is 1 edge definition vs. 3 nested constructors (SequentialAgent wrapping ParallelAgent + synthesizer).</li>' +
        '<li><strong>Execution behavior:</strong> Trace both. The spans should be nearly identical -- researcher first, then optimist + skeptic in parallel, then synthesizer.</li>' +
        '<li><strong>State flow:</strong> Both use output_key identically. Check session state -- the same 4 keys appear in both.</li>' +
        '</ul>' +

        '<p><strong>Step 4: Break an agent and compare error behavior</strong></p>' +
        '<p>Change the skeptic agent\'s model to an invalid value (e.g., <code>\'nonexistent-model\'</code>). Run both pipelines:</p>' +
        '<ul>' +
        '<li>What happens in the graph version? Does the synthesizer still run?</li>' +
        '<li>What happens in the template version? Does the SequentialAgent propagate the error?</li>' +
        '<li>Is the error message the same or different?</li>' +
        '</ul>',

      postEvidence: 'Template agents and graph workflows are two syntaxes for the same orchestration engine. Neither has scheduling, cost tracking, or concurrency control. The missing layer sits below both.'
    }
  ]
});
