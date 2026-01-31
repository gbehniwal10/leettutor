# LeetCode Interview Tutor - Technical Specification

## Project Overview

Build a browser-based LeetCode practice application that provides an interactive coding environment with an AI tutor powered by the Claude Agent SDK. The tutor uses the Socratic method to guide learning rather than providing direct solutions.

### Core Value Proposition
- **Progressive hints** instead of immediate solutions
- **Two modes**: relaxed learning mode and timed interview simulation
- **Real code execution** with test case validation
- **Session logging** for review and tracking progress
- **Uses Claude Max subscription** via Claude Agent SDK (no separate API costs)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│  Browser (localhost:8000)                                           │
├───────────────────────────────┬─────────────────────────────────────┤
│  Left Panel                   │  Right Panel                        │
│  ┌─────────────────────────┐  │  ┌───────────────────────────────┐  │
│  │ Problem Description     │  │  │ Chat with Claude              │  │
│  │ (collapsible)           │  │  │ (scrollable message history)  │  │
│  └─────────────────────────┘  │  │                               │  │
│  ┌─────────────────────────┐  │  │                               │  │
│  │ Code Editor (Monaco)    │  │  │                               │  │
│  │                         │  │  │                               │  │
│  │                         │  │  └───────────────────────────────┘  │
│  │                         │  │  ┌───────────────────────────────┐  │
│  └─────────────────────────┘  │  │ Message input                 │  │
│  ┌─────────────────────────┐  │  └───────────────────────────────┘  │
│  │ [▶ Run] [Submit] [Hint] │  │                                     │
│  └─────────────────────────┘  │  Mode: [Learning ▼]  ⏱ 23:45       │
│  ┌─────────────────────────┐  │                                     │
│  │ Test Results Output     │  │                                     │
│  └─────────────────────────┘  │                                     │
└───────────────────────────────┴─────────────────────────────────────┘
```

---

## Tech Stack

### Frontend
- **Vanilla HTML/CSS/JS** (no build step required)
- **Monaco Editor** (VS Code's editor, loaded via CDN)
- **WebSocket** for real-time chat with backend
- **CSS Grid/Flexbox** for responsive layout

### Backend
- **Python 3.11+**
- **FastAPI** for HTTP endpoints and WebSocket handling
- **claude-code-sdk** (Claude Agent SDK) for AI tutor integration
- **uvicorn** as ASGI server

### Data Storage
- **JSON files** for session logs (no database needed)
- **In-memory** problem bank (can be extended to JSON files later)

---

## File Structure

```
leetcode-tutor/
├── README.md
├── requirements.txt
├── run.py                      # Entry point: starts the server
│
├── backend/
│   ├── __init__.py
│   ├── server.py               # FastAPI app, routes, WebSocket
│   ├── tutor.py                # Claude Agent SDK integration
│   ├── executor.py             # Sandboxed Python code execution
│   ├── problems.py             # Problem bank and test cases
│   └── session_logger.py       # Session logging utilities
│
├── frontend/
│   ├── index.html              # Main HTML structure
│   ├── style.css               # Styling
│   └── app.js                  # Frontend logic
│
├── sessions/                   # Created at runtime
│   └── {session_id}.json       # Individual session logs
│
└── workspace/                  # Created at runtime
    └── solution.py             # User's current code (for Claude to read)
```

---

## Detailed Component Specifications

### 1. Backend Server (`backend/server.py`)

#### HTTP Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Serve `index.html` |
| `/static/{path}` | GET | Serve CSS/JS files |
| `/api/problems` | GET | List available problems (title, difficulty, tags) |
| `/api/problems/{id}` | GET | Get specific problem details |
| `/api/run` | POST | Execute code against test cases |
| `/api/submit` | POST | Final submission (runs all test cases) |
| `/api/sessions` | GET | List past sessions |
| `/api/sessions/{id}` | GET | Get specific session details |

#### WebSocket Endpoint

| Endpoint | Description |
|----------|-------------|
| `/ws/chat` | Bidirectional chat with Claude tutor |

#### WebSocket Message Protocol

**Client → Server:**
```json
{
  "type": "message" | "start_session" | "end_session" | "request_hint",
  "content": "user's message",
  "problem_id": "two-sum",
  "mode": "learning" | "interview",
  "code": "def solution():\n    pass",
  "test_results": { "passed": 2, "failed": 1, "results": [...] }
}
```

**Server → Client:**
```json
{
  "type": "assistant_message" | "assistant_chunk" | "session_started" | "error",
  "content": "Claude's response or chunk",
  "session_id": "uuid",
  "timestamp": "ISO8601"
}
```

Use `assistant_chunk` for streaming responses, `assistant_message` for complete messages.

---

### 2. Claude Tutor Integration (`backend/tutor.py`)

#### System Prompts

**Learning Mode:**
```
You are a supportive coding tutor helping someone practice LeetCode problems. Your goal is to guide them to discover solutions themselves, not to give answers directly.

CURRENT CONTEXT:
- Problem: {problem_title}
- Problem Description: {problem_description}
- User's Current Code: (saved at ./workspace/solution.py, you can read it)
- Latest Test Results: {test_results}
- Hints Given So Far: {hint_count}

HINT LADDER (only advance when truly stuck):
1. Ask clarifying questions: "What approach are you considering?" "What's blocking you?"
2. Suggest the pattern category: "This is a classic [hash map / two pointers / sliding window] problem"
3. Name the key data structure: "A hash map would help here because..."
4. Explain the core insight abstractly: "The key insight is that for each element, we need to..."
5. Provide pseudocode outline (last resort): "The general structure would be: 1) Initialize... 2) Loop through..."

GUIDELINES:
- Celebrate partial progress! "Nice, that's the right direction!"
- If their code passes some tests, acknowledge what's working before addressing failures
- Ask them to explain their time/space complexity after they solve it
- Suggest edge cases they might have missed
- Never give the complete solution code
- Be encouraging but not patronizing
- If they seem frustrated, offer to take a step back and review the problem together
```

**Interview Mode:**
```
You are a technical interviewer conducting a mock coding interview. Be professional, supportive, but maintain the pressure of a real interview.

CURRENT CONTEXT:
- Problem: {problem_title}
- Time Remaining: {time_remaining}
- User's Current Code: (saved at ./workspace/solution.py, you can read it)
- Latest Test Results: {test_results}

INTERVIEW PROTOCOL:
1. CLARIFICATION PHASE: If they haven't asked clarifying questions, prompt: "Before you start coding, do you have any questions about the problem?"

2. CODING PHASE:
   - Let them think and struggle a bit (this is normal in interviews)
   - If stuck for >2 minutes with no progress, give a small nudge: "What data structure might help here?"
   - Watch for: edge case handling, variable naming, code organization

3. REVIEW PHASE (after they submit or time runs out):
   - "Walk me through your solution"
   - "What's the time complexity? Space complexity?"
   - "How would you test this?"
   - "What if the input was 10^9 elements?"
   - If suboptimal: "Is there a way to improve this?"

GUIDELINES:
- Keep responses concise (interviewers don't give speeches)
- Note when they explain their thinking out loud (good interview practice)
- If they go silent, prompt: "Talk me through what you're thinking"
- Be encouraging when they make progress, but don't over-praise
```

#### Claude Agent SDK Integration

```python
from claude_code_sdk import query, ClaudeCodeOptions, ClaudeSDKClient, AssistantMessage, TextBlock

class LeetCodeTutor:
    def __init__(self, mode: str, problem: dict, workspace_path: str):
        self.mode = mode
        self.problem = problem
        self.hint_count = 0
        self.conversation_history = []
        
        system_prompt = self._build_system_prompt()
        
        self.options = ClaudeCodeOptions(
            system_prompt=system_prompt,
            allowed_tools=["Read"],  # Claude can read the solution file
            cwd=workspace_path
        )
        self.client = None
    
    async def start_session(self):
        """Initialize the SDK client"""
        self.client = ClaudeSDKClient(options=self.options)
        await self.client.__aenter__()
    
    async def chat(self, user_message: str, code: str = None, test_results: dict = None):
        """Send a message and stream the response"""
        # Update context with latest code/results if provided
        context = self._build_context(code, test_results)
        full_message = f"{context}\n\nUser: {user_message}" if context else user_message
        
        await self.client.query(full_message)
        
        async for msg in self.client.receive_response():
            if isinstance(msg, AssistantMessage):
                for block in msg.content:
                    if isinstance(block, TextBlock):
                        yield block.text
    
    async def end_session(self):
        """Clean up"""
        if self.client:
            await self.client.__aexit__(None, None, None)
    
    def _build_system_prompt(self) -> str:
        # Return appropriate prompt based on mode
        pass
    
    def _build_context(self, code: str, test_results: dict) -> str:
        # Build context string with current code and test results
        pass
```

---

### 3. Code Executor (`backend/executor.py`)

Executes user code safely with timeout protection.

```python
import subprocess
import tempfile
import json
from pathlib import Path

class CodeExecutor:
    def __init__(self, timeout: int = 5):
        self.timeout = timeout
    
    def run_tests(self, code: str, test_cases: list[dict]) -> dict:
        """
        Execute code against test cases.
        
        Args:
            code: User's Python code (must define the required function)
            test_cases: List of {"input": {...}, "expected": ...}
        
        Returns:
            {
                "passed": int,
                "failed": int,
                "results": [
                    {
                        "test_num": 1,
                        "input": {...},
                        "expected": ...,
                        "actual": ...,
                        "passed": bool,
                        "error": str | None,
                        "runtime_ms": float
                    }
                ]
            }
        """
        results = []
        
        for i, test in enumerate(test_cases):
            result = self._run_single_test(code, test, i + 1)
            results.append(result)
        
        passed = sum(1 for r in results if r["passed"])
        
        return {
            "passed": passed,
            "failed": len(results) - passed,
            "results": results
        }
    
    def _run_single_test(self, code: str, test: dict, test_num: int) -> dict:
        """Run a single test case"""
        # Create a wrapper script that:
        # 1. Defines the user's code
        # 2. Calls the function with test input
        # 3. Prints the result as JSON
        
        wrapper = f'''
import json
import time

{code}

if __name__ == "__main__":
    test_input = {json.dumps(test["input"])}
    start = time.perf_counter()
    try:
        # Call the solution function (name varies by problem)
        result = {test["function_call"]}
        elapsed = (time.perf_counter() - start) * 1000
        print(json.dumps({{"result": result, "runtime_ms": elapsed}}))
    except Exception as e:
        print(json.dumps({{"error": str(e)}}))
'''
        
        with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False) as f:
            f.write(wrapper)
            f.flush()
            
            try:
                result = subprocess.run(
                    ['python', f.name],
                    capture_output=True,
                    timeout=self.timeout,
                    text=True
                )
                
                if result.returncode != 0:
                    return {
                        "test_num": test_num,
                        "input": test["input"],
                        "expected": test["expected"],
                        "actual": None,
                        "passed": False,
                        "error": result.stderr.strip(),
                        "runtime_ms": None
                    }
                
                output = json.loads(result.stdout)
                
                if "error" in output:
                    return {
                        "test_num": test_num,
                        "input": test["input"],
                        "expected": test["expected"],
                        "actual": None,
                        "passed": False,
                        "error": output["error"],
                        "runtime_ms": None
                    }
                
                return {
                    "test_num": test_num,
                    "input": test["input"],
                    "expected": test["expected"],
                    "actual": output["result"],
                    "passed": output["result"] == test["expected"],
                    "error": None,
                    "runtime_ms": output["runtime_ms"]
                }
                
            except subprocess.TimeoutExpired:
                return {
                    "test_num": test_num,
                    "input": test["input"],
                    "expected": test["expected"],
                    "actual": None,
                    "passed": False,
                    "error": f"Time Limit Exceeded ({self.timeout}s)",
                    "runtime_ms": None
                }
            finally:
                Path(f.name).unlink()
```

---

### 4. Problem Bank (`backend/problems.py`)

Start with a small curated set of classic problems. Structure allows easy expansion.

```python
PROBLEMS = {
    "two-sum": {
        "id": "two-sum",
        "title": "Two Sum",
        "difficulty": "easy",
        "tags": ["array", "hash-map"],
        "description": """
Given an array of integers `nums` and an integer `target`, return the indices of the two numbers that add up to `target`.

You may assume that each input would have exactly one solution, and you may not use the same element twice.

You can return the answer in any order.

**Example 1:**
```
Input: nums = [2,7,11,15], target = 9
Output: [0,1]
Explanation: Because nums[0] + nums[1] == 9, we return [0, 1].
```

**Example 2:**
```
Input: nums = [3,2,4], target = 6
Output: [1,2]
```

**Constraints:**
- 2 <= nums.length <= 10^4
- -10^9 <= nums[i] <= 10^9
- -10^9 <= target <= 10^9
- Only one valid answer exists.
""",
        "starter_code": """def twoSum(nums: list[int], target: int) -> list[int]:
    # Your code here
    pass
""",
        "function_name": "twoSum",
        "test_cases": [
            {
                "input": {"nums": [2, 7, 11, 15], "target": 9},
                "expected": [0, 1],
                "function_call": "twoSum(**test_input)"
            },
            {
                "input": {"nums": [3, 2, 4], "target": 6},
                "expected": [1, 2],
                "function_call": "twoSum(**test_input)"
            },
            {
                "input": {"nums": [3, 3], "target": 6},
                "expected": [0, 1],
                "function_call": "twoSum(**test_input)"
            }
        ],
        "hidden_test_cases": [
            # Additional test cases for final submission
            {
                "input": {"nums": [1, 2, 3, 4, 5], "target": 9},
                "expected": [3, 4],
                "function_call": "twoSum(**test_input)"
            }
        ],
        "hints": [
            "What data structure allows O(1) lookup?",
            "For each number, what are you looking for?",
            "Can you store numbers you've seen as you iterate?"
        ],
        "optimal_complexity": {
            "time": "O(n)",
            "space": "O(n)"
        }
    },
    
    "valid-parentheses": {
        "id": "valid-parentheses",
        "title": "Valid Parentheses",
        "difficulty": "easy",
        "tags": ["string", "stack"],
        "description": """
Given a string `s` containing just the characters `'('`, `')'`, `'{'`, `'}'`, `'['` and `']'`, determine if the input string is valid.

An input string is valid if:
1. Open brackets must be closed by the same type of brackets.
2. Open brackets must be closed in the correct order.
3. Every close bracket has a corresponding open bracket of the same type.

**Example 1:**
```
Input: s = "()"
Output: true
```

**Example 2:**
```
Input: s = "()[]{}"
Output: true
```

**Example 3:**
```
Input: s = "(]"
Output: false
```

**Constraints:**
- 1 <= s.length <= 10^4
- s consists of parentheses only '()[]{}'.
""",
        "starter_code": """def isValid(s: str) -> bool:
    # Your code here
    pass
""",
        "function_name": "isValid",
        "test_cases": [
            {
                "input": {"s": "()"},
                "expected": True,
                "function_call": "isValid(**test_input)"
            },
            {
                "input": {"s": "()[]{}"},
                "expected": True,
                "function_call": "isValid(**test_input)"
            },
            {
                "input": {"s": "(]"},
                "expected": False,
                "function_call": "isValid(**test_input)"
            },
            {
                "input": {"s": "([)]"},
                "expected": False,
                "function_call": "isValid(**test_input)"
            }
        ],
        "hidden_test_cases": [],
        "hints": [
            "What data structure follows Last-In-First-Out (LIFO)?",
            "When you see an opening bracket, what should you do?",
            "When you see a closing bracket, what should you check?"
        ],
        "optimal_complexity": {
            "time": "O(n)",
            "space": "O(n)"
        }
    },
    
    "best-time-to-buy-sell-stock": {
        "id": "best-time-to-buy-sell-stock",
        "title": "Best Time to Buy and Sell Stock",
        "difficulty": "easy",
        "tags": ["array", "dynamic-programming", "sliding-window"],
        "description": """
You are given an array `prices` where `prices[i]` is the price of a given stock on the ith day.

You want to maximize your profit by choosing a single day to buy one stock and choosing a different day in the future to sell that stock.

Return the maximum profit you can achieve from this transaction. If you cannot achieve any profit, return 0.

**Example 1:**
```
Input: prices = [7,1,5,3,6,4]
Output: 5
Explanation: Buy on day 2 (price = 1) and sell on day 5 (price = 6), profit = 6-1 = 5.
```

**Example 2:**
```
Input: prices = [7,6,4,3,1]
Output: 0
Explanation: No transactions are done, max profit = 0.
```

**Constraints:**
- 1 <= prices.length <= 10^5
- 0 <= prices[i] <= 10^4
""",
        "starter_code": """def maxProfit(prices: list[int]) -> int:
    # Your code here
    pass
""",
        "function_name": "maxProfit",
        "test_cases": [
            {
                "input": {"prices": [7, 1, 5, 3, 6, 4]},
                "expected": 5,
                "function_call": "maxProfit(**test_input)"
            },
            {
                "input": {"prices": [7, 6, 4, 3, 1]},
                "expected": 0,
                "function_call": "maxProfit(**test_input)"
            },
            {
                "input": {"prices": [2, 4, 1]},
                "expected": 2,
                "function_call": "maxProfit(**test_input)"
            }
        ],
        "hidden_test_cases": [],
        "hints": [
            "You must buy before you sell. How does this constrain your approach?",
            "What if you kept track of the minimum price seen so far?",
            "At each day, what's the best profit you could make if you sold today?"
        ],
        "optimal_complexity": {
            "time": "O(n)",
            "space": "O(1)"
        }
    }
}

def get_problem(problem_id: str) -> dict | None:
    return PROBLEMS.get(problem_id)

def list_problems() -> list[dict]:
    return [
        {
            "id": p["id"],
            "title": p["title"],
            "difficulty": p["difficulty"],
            "tags": p["tags"]
        }
        for p in PROBLEMS.values()
    ]

def get_random_problem(difficulty: str = None, tags: list[str] = None) -> dict:
    import random
    
    candidates = list(PROBLEMS.values())
    
    if difficulty:
        candidates = [p for p in candidates if p["difficulty"] == difficulty]
    
    if tags:
        candidates = [p for p in candidates if any(t in p["tags"] for t in tags)]
    
    return random.choice(candidates) if candidates else None
```

---

### 5. Session Logger (`backend/session_logger.py`)

```python
import json
from datetime import datetime
from pathlib import Path
from uuid import uuid4

class SessionLogger:
    def __init__(self, sessions_dir: str = "sessions"):
        self.sessions_dir = Path(sessions_dir)
        self.sessions_dir.mkdir(exist_ok=True)
        self.current_session = None
    
    def start_session(self, problem_id: str, mode: str) -> str:
        """Start a new session and return its ID"""
        session_id = str(uuid4())[:8]
        
        self.current_session = {
            "session_id": session_id,
            "problem_id": problem_id,
            "mode": mode,
            "started_at": datetime.now().isoformat(),
            "ended_at": None,
            "duration_seconds": None,
            "hints_requested": 0,
            "code_submissions": [],
            "chat_history": [],
            "final_result": None,
            "notes": ""
        }
        
        self._save()
        return session_id
    
    def log_message(self, role: str, content: str):
        """Log a chat message"""
        if not self.current_session:
            return
        
        self.current_session["chat_history"].append({
            "role": role,
            "content": content,
            "timestamp": datetime.now().isoformat()
        })
        self._save()
    
    def log_code_submission(self, code: str, test_results: dict):
        """Log a code submission with results"""
        if not self.current_session:
            return
        
        self.current_session["code_submissions"].append({
            "code": code,
            "test_results": test_results,
            "timestamp": datetime.now().isoformat()
        })
        self._save()
    
    def log_hint_requested(self):
        """Increment hint counter"""
        if not self.current_session:
            return
        
        self.current_session["hints_requested"] += 1
        self._save()
    
    def end_session(self, final_result: str = None, notes: str = ""):
        """End the current session"""
        if not self.current_session:
            return
        
        started = datetime.fromisoformat(self.current_session["started_at"])
        ended = datetime.now()
        
        self.current_session["ended_at"] = ended.isoformat()
        self.current_session["duration_seconds"] = (ended - started).total_seconds()
        self.current_session["final_result"] = final_result
        self.current_session["notes"] = notes
        
        self._save()
        self.current_session = None
    
    def _save(self):
        """Save current session to disk"""
        if not self.current_session:
            return
        
        filepath = self.sessions_dir / f"{self.current_session['session_id']}.json"
        with open(filepath, 'w') as f:
            json.dump(self.current_session, f, indent=2)
    
    def list_sessions(self) -> list[dict]:
        """List all sessions (summary only)"""
        sessions = []
        for filepath in self.sessions_dir.glob("*.json"):
            with open(filepath) as f:
                data = json.load(f)
                sessions.append({
                    "session_id": data["session_id"],
                    "problem_id": data["problem_id"],
                    "mode": data["mode"],
                    "started_at": data["started_at"],
                    "duration_seconds": data["duration_seconds"],
                    "final_result": data["final_result"]
                })
        
        return sorted(sessions, key=lambda x: x["started_at"], reverse=True)
    
    def get_session(self, session_id: str) -> dict | None:
        """Get full session details"""
        filepath = self.sessions_dir / f"{session_id}.json"
        if filepath.exists():
            with open(filepath) as f:
                return json.load(f)
        return None
```

---

### 6. Frontend (`frontend/index.html`)

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>LeetCode Tutor</title>
    <link rel="stylesheet" href="/static/style.css">
    <!-- Monaco Editor -->
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs/editor/editor.main.min.css">
</head>
<body>
    <div class="container">
        <!-- Header -->
        <header class="header">
            <h1>LeetCode Tutor</h1>
            <div class="controls">
                <select id="mode-select">
                    <option value="learning">Learning Mode</option>
                    <option value="interview">Interview Mode</option>
                </select>
                <button id="new-problem-btn">New Problem</button>
                <div id="timer" class="timer hidden">⏱ <span id="timer-display">45:00</span></div>
            </div>
        </header>
        
        <!-- Main Content -->
        <main class="main">
            <!-- Left Panel: Problem + Editor -->
            <div class="left-panel">
                <!-- Problem Description -->
                <div class="problem-section">
                    <div class="problem-header">
                        <h2 id="problem-title">Select a Problem</h2>
                        <span id="problem-difficulty" class="difficulty"></span>
                        <button id="toggle-problem" class="toggle-btn">▼</button>
                    </div>
                    <div id="problem-description" class="problem-description">
                        <!-- Rendered markdown -->
                    </div>
                </div>
                
                <!-- Code Editor -->
                <div class="editor-section">
                    <div id="editor" class="editor"></div>
                </div>
                
                <!-- Action Buttons -->
                <div class="actions">
                    <button id="run-btn" class="btn btn-secondary">▶ Run</button>
                    <button id="submit-btn" class="btn btn-primary">Submit</button>
                    <button id="hint-btn" class="btn btn-hint">💡 Hint</button>
                </div>
                
                <!-- Test Results -->
                <div id="test-results" class="test-results">
                    <!-- Populated by JS -->
                </div>
            </div>
            
            <!-- Right Panel: Chat -->
            <div class="right-panel">
                <div id="chat-messages" class="chat-messages">
                    <!-- Chat history -->
                </div>
                <div class="chat-input-container">
                    <textarea 
                        id="chat-input" 
                        placeholder="Ask for help, explain your thinking, or discuss your approach..."
                        rows="3"
                    ></textarea>
                    <button id="send-btn" class="btn btn-primary">Send</button>
                </div>
            </div>
        </main>
    </div>

    <!-- Problem Selection Modal -->
    <div id="problem-modal" class="modal hidden">
        <div class="modal-content">
            <h2>Select a Problem</h2>
            <div id="problem-list" class="problem-list">
                <!-- Populated by JS -->
            </div>
            <button id="close-modal" class="btn">Cancel</button>
        </div>
    </div>

    <!-- Scripts -->
    <script src="https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs/loader.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
    <script src="/static/app.js"></script>
</body>
</html>
```

---

### 7. Frontend Styles (`frontend/style.css`)

```css
:root {
    --bg-primary: #1e1e1e;
    --bg-secondary: #252526;
    --bg-tertiary: #2d2d30;
    --text-primary: #cccccc;
    --text-secondary: #808080;
    --accent-blue: #0078d4;
    --accent-green: #4ec9b0;
    --accent-yellow: #dcdcaa;
    --accent-red: #f14c4c;
    --border-color: #3c3c3c;
}

* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: 'Segoe UI', system-ui, sans-serif;
    background: var(--bg-primary);
    color: var(--text-primary);
    height: 100vh;
    overflow: hidden;
}

.container {
    display: flex;
    flex-direction: column;
    height: 100vh;
}

/* Header */
.header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 20px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border-color);
}

.header h1 {
    font-size: 1.25rem;
    font-weight: 600;
}

.controls {
    display: flex;
    gap: 12px;
    align-items: center;
}

.timer {
    font-family: 'Consolas', monospace;
    font-size: 1.1rem;
    padding: 6px 12px;
    background: var(--bg-tertiary);
    border-radius: 4px;
}

.timer.warning {
    color: var(--accent-yellow);
}

.timer.danger {
    color: var(--accent-red);
}

/* Main Layout */
.main {
    display: flex;
    flex: 1;
    overflow: hidden;
}

.left-panel, .right-panel {
    display: flex;
    flex-direction: column;
    overflow: hidden;
}

.left-panel {
    flex: 1;
    border-right: 1px solid var(--border-color);
}

.right-panel {
    width: 400px;
    min-width: 300px;
    max-width: 500px;
    resize: horizontal;
    overflow: hidden;
}

/* Problem Section */
.problem-section {
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border-color);
    max-height: 40%;
    overflow: hidden;
    display: flex;
    flex-direction: column;
}

.problem-section.collapsed {
    max-height: 50px;
}

.problem-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    cursor: pointer;
}

.problem-header h2 {
    font-size: 1rem;
    flex: 1;
}

.difficulty {
    font-size: 0.75rem;
    padding: 2px 8px;
    border-radius: 4px;
    text-transform: uppercase;
}

.difficulty.easy { background: #2d5a27; color: #4ec9b0; }
.difficulty.medium { background: #5a4a27; color: #dcdcaa; }
.difficulty.hard { background: #5a2727; color: #f14c4c; }

.toggle-btn {
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    transition: transform 0.2s;
}

.problem-section.collapsed .toggle-btn {
    transform: rotate(-90deg);
}

.problem-description {
    padding: 0 16px 16px;
    overflow-y: auto;
    font-size: 0.9rem;
    line-height: 1.6;
}

.problem-description pre {
    background: var(--bg-tertiary);
    padding: 12px;
    border-radius: 4px;
    overflow-x: auto;
}

.problem-description code {
    font-family: 'Consolas', monospace;
}

/* Editor Section */
.editor-section {
    flex: 1;
    min-height: 200px;
}

.editor {
    height: 100%;
}

/* Actions */
.actions {
    display: flex;
    gap: 8px;
    padding: 12px 16px;
    background: var(--bg-secondary);
    border-top: 1px solid var(--border-color);
}

.btn {
    padding: 8px 16px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.875rem;
    transition: background 0.2s;
}

.btn-primary {
    background: var(--accent-blue);
    color: white;
}

.btn-primary:hover {
    background: #1084d8;
}

.btn-secondary {
    background: var(--bg-tertiary);
    color: var(--text-primary);
}

.btn-secondary:hover {
    background: #3c3c3c;
}

.btn-hint {
    background: #5a4a27;
    color: var(--accent-yellow);
    margin-left: auto;
}

/* Test Results */
.test-results {
    padding: 12px 16px;
    background: var(--bg-secondary);
    border-top: 1px solid var(--border-color);
    max-height: 150px;
    overflow-y: auto;
    font-family: 'Consolas', monospace;
    font-size: 0.85rem;
}

.test-result {
    padding: 4px 0;
}

.test-result.passed {
    color: var(--accent-green);
}

.test-result.failed {
    color: var(--accent-red);
}

/* Chat Panel */
.chat-messages {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.chat-message {
    max-width: 90%;
    padding: 10px 14px;
    border-radius: 8px;
    font-size: 0.9rem;
    line-height: 1.5;
}

.chat-message.user {
    align-self: flex-end;
    background: var(--accent-blue);
    color: white;
}

.chat-message.assistant {
    align-self: flex-start;
    background: var(--bg-tertiary);
}

.chat-message.system {
    align-self: center;
    background: transparent;
    color: var(--text-secondary);
    font-size: 0.8rem;
    font-style: italic;
}

.chat-input-container {
    display: flex;
    gap: 8px;
    padding: 12px 16px;
    background: var(--bg-secondary);
    border-top: 1px solid var(--border-color);
}

#chat-input {
    flex: 1;
    padding: 10px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    color: var(--text-primary);
    font-family: inherit;
    font-size: 0.9rem;
    resize: none;
}

#chat-input:focus {
    outline: none;
    border-color: var(--accent-blue);
}

/* Modal */
.modal {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
}

.modal.hidden {
    display: none;
}

.modal-content {
    background: var(--bg-secondary);
    padding: 24px;
    border-radius: 8px;
    min-width: 400px;
    max-width: 600px;
}

.modal-content h2 {
    margin-bottom: 16px;
}

.problem-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 16px;
    max-height: 400px;
    overflow-y: auto;
}

.problem-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px;
    background: var(--bg-tertiary);
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.2s;
}

.problem-item:hover {
    background: #3c3c3c;
}

.problem-item .title {
    flex: 1;
}

.problem-item .tags {
    display: flex;
    gap: 4px;
}

.problem-item .tag {
    font-size: 0.7rem;
    padding: 2px 6px;
    background: var(--bg-primary);
    border-radius: 2px;
    color: var(--text-secondary);
}

/* Utilities */
.hidden {
    display: none !important;
}

/* Scrollbar */
::-webkit-scrollbar {
    width: 8px;
    height: 8px;
}

::-webkit-scrollbar-track {
    background: var(--bg-primary);
}

::-webkit-scrollbar-thumb {
    background: var(--bg-tertiary);
    border-radius: 4px;
}

::-webkit-scrollbar-thumb:hover {
    background: #4a4a4a;
}

/* Select */
select {
    padding: 6px 12px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    color: var(--text-primary);
    cursor: pointer;
}
```

---

### 8. Frontend Logic (`frontend/app.js`)

```javascript
// ============================================
// State Management
// ============================================
const state = {
    mode: 'learning',
    currentProblem: null,
    sessionId: null,
    editor: null,
    ws: null,
    timerInterval: null,
    timeRemaining: 45 * 60, // 45 minutes for interview mode
};

// ============================================
// Initialization
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    initMonacoEditor();
    initWebSocket();
    initEventListeners();
    loadProblems();
});

function initMonacoEditor() {
    require.config({ paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs' } });
    
    require(['vs/editor/editor.main'], function () {
        // Define dark theme
        monaco.editor.defineTheme('leetcode-dark', {
            base: 'vs-dark',
            inherit: true,
            rules: [],
            colors: {
                'editor.background': '#1e1e1e',
            }
        });
        
        state.editor = monaco.editor.create(document.getElementById('editor'), {
            value: '# Select a problem to begin',
            language: 'python',
            theme: 'leetcode-dark',
            fontSize: 14,
            minimap: { enabled: false },
            automaticLayout: true,
            scrollBeyondLastLine: false,
            lineNumbers: 'on',
            renderWhitespace: 'selection',
            tabSize: 4,
        });
    });
}

function initWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    state.ws = new WebSocket(`${protocol}//${window.location.host}/ws/chat`);
    
    state.ws.onopen = () => {
        console.log('WebSocket connected');
    };
    
    state.ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleWebSocketMessage(data);
    };
    
    state.ws.onclose = () => {
        console.log('WebSocket disconnected');
        // Attempt reconnection after 3 seconds
        setTimeout(initWebSocket, 3000);
    };
    
    state.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
    };
}

function initEventListeners() {
    // Mode selection
    document.getElementById('mode-select').addEventListener('change', (e) => {
        state.mode = e.target.value;
        updateModeUI();
    });
    
    // Problem selection
    document.getElementById('new-problem-btn').addEventListener('click', showProblemModal);
    document.getElementById('close-modal').addEventListener('click', hideProblemModal);
    
    // Problem description toggle
    document.getElementById('toggle-problem').addEventListener('click', toggleProblemDescription);
    
    // Code actions
    document.getElementById('run-btn').addEventListener('click', runCode);
    document.getElementById('submit-btn').addEventListener('click', submitCode);
    document.getElementById('hint-btn').addEventListener('click', requestHint);
    
    // Chat
    document.getElementById('send-btn').addEventListener('click', sendMessage);
    document.getElementById('chat-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
}

// ============================================
// Problem Management
// ============================================
async function loadProblems() {
    try {
        const response = await fetch('/api/problems');
        const problems = await response.json();
        renderProblemList(problems);
    } catch (error) {
        console.error('Failed to load problems:', error);
    }
}

function renderProblemList(problems) {
    const container = document.getElementById('problem-list');
    container.innerHTML = problems.map(p => `
        <div class="problem-item" data-id="${p.id}">
            <span class="title">${p.title}</span>
            <span class="difficulty ${p.difficulty}">${p.difficulty}</span>
            <div class="tags">
                ${p.tags.map(t => `<span class="tag">${t}</span>`).join('')}
            </div>
        </div>
    `).join('');
    
    // Add click handlers
    container.querySelectorAll('.problem-item').forEach(item => {
        item.addEventListener('click', () => selectProblem(item.dataset.id));
    });
}

async function selectProblem(problemId) {
    try {
        const response = await fetch(`/api/problems/${problemId}`);
        state.currentProblem = await response.json();
        
        // Update UI
        document.getElementById('problem-title').textContent = state.currentProblem.title;
        document.getElementById('problem-difficulty').textContent = state.currentProblem.difficulty;
        document.getElementById('problem-difficulty').className = `difficulty ${state.currentProblem.difficulty}`;
        document.getElementById('problem-description').innerHTML = marked.parse(state.currentProblem.description);
        
        // Set starter code in editor
        state.editor.setValue(state.currentProblem.starter_code);
        
        // Start session
        startSession();
        
        hideProblemModal();
    } catch (error) {
        console.error('Failed to load problem:', error);
    }
}

function showProblemModal() {
    document.getElementById('problem-modal').classList.remove('hidden');
}

function hideProblemModal() {
    document.getElementById('problem-modal').classList.add('hidden');
}

function toggleProblemDescription() {
    document.querySelector('.problem-section').classList.toggle('collapsed');
}

// ============================================
// Session Management
// ============================================
function startSession() {
    // Send session start message
    state.ws.send(JSON.stringify({
        type: 'start_session',
        problem_id: state.currentProblem.id,
        mode: state.mode
    }));
    
    // Clear chat
    document.getElementById('chat-messages').innerHTML = '';
    
    // Add system message
    addChatMessage('system', `Starting ${state.mode} session for "${state.currentProblem.title}"`);
    
    // Start timer in interview mode
    if (state.mode === 'interview') {
        startTimer();
    }
}

// ============================================
// Timer
// ============================================
function startTimer() {
    state.timeRemaining = 45 * 60;
    document.getElementById('timer').classList.remove('hidden');
    updateTimerDisplay();
    
    state.timerInterval = setInterval(() => {
        state.timeRemaining--;
        updateTimerDisplay();
        
        if (state.timeRemaining <= 0) {
            clearInterval(state.timerInterval);
            handleTimeUp();
        }
    }, 1000);
}

function updateTimerDisplay() {
    const minutes = Math.floor(state.timeRemaining / 60);
    const seconds = state.timeRemaining % 60;
    const display = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    document.getElementById('timer-display').textContent = display;
    
    const timer = document.getElementById('timer');
    timer.classList.remove('warning', 'danger');
    if (state.timeRemaining <= 300) {
        timer.classList.add('danger');
    } else if (state.timeRemaining <= 600) {
        timer.classList.add('warning');
    }
}

function handleTimeUp() {
    addChatMessage('system', "⏱ Time's up! Let's review your solution.");
    // Trigger review phase
    state.ws.send(JSON.stringify({
        type: 'message',
        content: '[TIME UP - Please conduct the review phase]',
        code: state.editor.getValue()
    }));
}

function updateModeUI() {
    if (state.mode === 'learning') {
        document.getElementById('timer').classList.add('hidden');
        if (state.timerInterval) {
            clearInterval(state.timerInterval);
        }
    }
}

// ============================================
// Code Execution
// ============================================
async function runCode() {
    if (!state.currentProblem) {
        alert('Please select a problem first');
        return;
    }
    
    const code = state.editor.getValue();
    
    try {
        const response = await fetch('/api/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                code,
                problem_id: state.currentProblem.id
            })
        });
        
        const results = await response.json();
        displayTestResults(results);
        
        // Notify Claude of results (without user message)
        state.ws.send(JSON.stringify({
            type: 'message',
            content: '[User ran their code]',
            code,
            test_results: results
        }));
        
    } catch (error) {
        console.error('Failed to run code:', error);
    }
}

async function submitCode() {
    if (!state.currentProblem) {
        alert('Please select a problem first');
        return;
    }
    
    const code = state.editor.getValue();
    
    try {
        const response = await fetch('/api/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                code,
                problem_id: state.currentProblem.id
            })
        });
        
        const results = await response.json();
        displayTestResults(results);
        
        // Notify Claude
        const passed = results.passed === results.passed + results.failed;
        state.ws.send(JSON.stringify({
            type: 'message',
            content: passed ? '[User submitted - ALL TESTS PASSED]' : '[User submitted - some tests failed]',
            code,
            test_results: results
        }));
        
        if (passed) {
            addChatMessage('system', '🎉 All tests passed! Great job!');
        }
        
    } catch (error) {
        console.error('Failed to submit code:', error);
    }
}

function displayTestResults(results) {
    const container = document.getElementById('test-results');
    
    const summary = `${results.passed}/${results.passed + results.failed} tests passed`;
    
    const resultItems = results.results.map(r => {
        if (r.passed) {
            return `<div class="test-result passed">✓ Test ${r.test_num}: Passed (${r.runtime_ms?.toFixed(2) || '?'}ms)</div>`;
        } else {
            const error = r.error || `Expected ${JSON.stringify(r.expected)}, got ${JSON.stringify(r.actual)}`;
            return `<div class="test-result failed">✗ Test ${r.test_num}: ${error}</div>`;
        }
    }).join('');
    
    container.innerHTML = `<div><strong>${summary}</strong></div>${resultItems}`;
}

// ============================================
// Hints
// ============================================
function requestHint() {
    if (!state.currentProblem) {
        alert('Please select a problem first');
        return;
    }
    
    state.ws.send(JSON.stringify({
        type: 'request_hint',
        code: state.editor.getValue()
    }));
}

// ============================================
// Chat
// ============================================
function sendMessage() {
    const input = document.getElementById('chat-input');
    const content = input.value.trim();
    
    if (!content) return;
    
    // Add user message to chat
    addChatMessage('user', content);
    
    // Send to server
    state.ws.send(JSON.stringify({
        type: 'message',
        content,
        code: state.editor.getValue()
    }));
    
    input.value = '';
}

function handleWebSocketMessage(data) {
    switch (data.type) {
        case 'session_started':
            state.sessionId = data.session_id;
            break;
            
        case 'assistant_message':
            addChatMessage('assistant', data.content);
            break;
            
        case 'assistant_chunk':
            // Handle streaming (append to last assistant message or create new)
            appendToLastAssistantMessage(data.content);
            break;
            
        case 'error':
            addChatMessage('system', `Error: ${data.content}`);
            break;
    }
}

function addChatMessage(role, content) {
    const container = document.getElementById('chat-messages');
    const message = document.createElement('div');
    message.className = `chat-message ${role}`;
    message.innerHTML = role === 'assistant' ? marked.parse(content) : escapeHtml(content);
    container.appendChild(message);
    container.scrollTop = container.scrollHeight;
}

function appendToLastAssistantMessage(content) {
    const container = document.getElementById('chat-messages');
    const lastMessage = container.querySelector('.chat-message.assistant:last-child');
    
    if (lastMessage && lastMessage.dataset.streaming === 'true') {
        // Append to existing streaming message
        lastMessage.dataset.content = (lastMessage.dataset.content || '') + content;
        lastMessage.innerHTML = marked.parse(lastMessage.dataset.content);
    } else {
        // Create new streaming message
        const message = document.createElement('div');
        message.className = 'chat-message assistant';
        message.dataset.streaming = 'true';
        message.dataset.content = content;
        message.innerHTML = marked.parse(content);
        container.appendChild(message);
    }
    
    container.scrollTop = container.scrollHeight;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
```

---

## Implementation Phases

### Phase 1: Basic Infrastructure (MVP)
**Goal: Get a working loop with one problem**

1. Set up project structure
2. Implement FastAPI server with basic routes
3. Create frontend with Monaco editor
4. Implement WebSocket communication
5. Add code executor with basic test running
6. Add ONE problem (Two Sum) to test the flow

**Deliverable:** User can select Two Sum, write code, run tests, and see results.

### Phase 2: Claude Integration
**Goal: Add the AI tutor**

1. Integrate Claude Agent SDK
2. Implement system prompts for learning mode
3. Create the chat interface
4. Wire up the hint button
5. Ensure Claude can read the user's current code

**Deliverable:** User can chat with Claude about their solution, request hints.

### Phase 3: Interview Mode
**Goal: Add timed interview simulation**

1. Implement interview mode system prompt
2. Add timer functionality
3. Handle time-up scenario
4. Add review phase prompts

**Deliverable:** User can do a full mock interview with timer and review.

### Phase 4: Session Logging & Polish
**Goal: Track progress and improve UX**

1. Implement session logger
2. Add session history view
3. Add more problems to the bank
4. Polish UI (loading states, error handling)
5. Add keyboard shortcuts

**Deliverable:** Complete application ready for daily use.

---

## Testing Checklist

### Functional Tests
- [ ] Problem selection loads problem and starter code
- [ ] Code execution returns correct pass/fail results
- [ ] WebSocket connection establishes and reconnects
- [ ] Chat messages send and receive correctly
- [ ] Claude responses stream properly
- [ ] Timer counts down and triggers review
- [ ] Session logs are saved correctly
- [ ] Hint button increments hint counter

### Edge Cases
- [ ] Code with infinite loop times out gracefully
- [ ] Invalid Python syntax shows helpful error
- [ ] WebSocket reconnects after disconnect
- [ ] Large code files don't break the editor
- [ ] Empty chat message is ignored

### UX Tests
- [ ] Problem description collapses/expands
- [ ] Chat scrolls to bottom on new messages
- [ ] Timer color changes at 10min and 5min remaining
- [ ] Modal closes on problem selection
- [ ] Enter key sends chat message

---

## Configuration Notes

### Environment Variables
```bash
# None required - uses existing Claude Code auth
# But these could be added for customization:

LEETCODE_TUTOR_PORT=8000
LEETCODE_TUTOR_HOST=localhost
LEETCODE_TUTOR_TIMEOUT=5  # Code execution timeout in seconds
```

### requirements.txt
```
fastapi>=0.100.0
uvicorn[standard]>=0.22.0
websockets>=11.0
claude-code-sdk>=0.1.0
```

---

## Notes for Claude Code

1. **Start with Phase 1** - get the basic infrastructure working before adding Claude integration
2. **Test incrementally** - run the server after each major component
3. **The workspace/ directory** - this is where user code gets saved for Claude to read
4. **WebSocket streaming** - use `assistant_chunk` messages for real-time streaming
5. **Error handling** - wrap all async operations in try/except
6. **The problem bank is intentionally small** - easy to extend later with more problems

---

## Future Enhancements (Out of Scope for v1)

- Multiple language support (JavaScript, Java, etc.)
- Difficulty-based problem recommendations  
- Spaced repetition for weak areas
- Code comparison with optimal solutions
- Voice input for interview mode
- Integration with actual LeetCode problem scraping
- Analytics dashboard with progress charts
