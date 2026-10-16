# copy-on-write-memory-demonstrator

"TEAM"
T.Jaswanth Reddy-2520030284,

CH.Manikanta-2520030239,

T.Karthik-2520030234



An educational Linux project that uses a real C `fork()` program to show process isolation and inspect available `/proc` memory accounting. The optional local Python dashboard launches only the fixed compiled program and displays its output. Its page drawing is explicitly conceptual: process-wide counters cannot identify a particular physical page with certainty.

## Problem and objectives

Students often learn that `fork()` uses Copy-on-Write without seeing a parent and child preserve different values. This project initializes a page-aligned private mapping before `fork()`, lets the child write after a synchronization point, shows the parent's unchanged value, and samples `smaps_rollup` while both processes are alive.

## Architecture and technologies

- `src/cow_demo.c`: page-aligned anonymous `mmap`, `fork`, pipes for deterministic observation phases, `waitpid`, and Linux `/proc/<pid>/smaps_rollup` reader.
- `backend/app.py`: optional localhost API using Python's standard library, with bounded input, a fixed executable path, no shell, a run lock, timeout, and output cap.
- `frontend/`: responsive HTML/CSS/JS dashboard. Live values and measurements come from the C program; without the backend it does not animate fake execution.

## Requirements

Ubuntu/Linux or WSL2 with GCC and Python 3.9+. The backend uses Python's standard library, so no pip packages are needed. `smaps_rollup` availability and access depend on kernel and procfs configuration. No root access is required.

## Build and run the C program

The C program and `/proc` observer require Linux. On Windows, use the installed Ubuntu WSL distribution and open the project from its mounted workspace in a WSL terminal or VS Code with the WSL extension. If needed, install GCC and Python once in Ubuntu with `sudo apt update && sudo apt install build-essential python3`. Do not compile this source with native Windows GCC.

From the project root:

```sh
gcc -Wall -Wextra -O0 src/cow_demo.c -o cow_demo
./cow_demo
./cow_demo 8    # optional: initialize and modify one location on each of 8 pages
./cow_demo 1 17 203  # optional: page count, parent start value, child write value
```

The parent and child values are bytes from 0 to 255 and must be different. The dashboard has matching value fields; the displayed process values come from the C program's output.

Expected shape (PIDs and memory counters vary):

```text
Copy-on-Write Memory Demonstrator
Parent PID: ...
Pages: 1 (... bytes)
Initial value at each page: 42
Child PID: ...
Child reads initial value: 42
[Observation: after fork, before child write]
...
Child modified 1 page location(s); value now: 90
Parent value after child write: 42 (unchanged)
[Observation: after child write]
...
Result: parent PID ... retains 42; child PID ... wrote 90.
```

## Memory observation: interpretation

The program reads the parent's and child's `smaps_rollup` while they are paused at two coordinated points. It reports `Rss` (resident pages), `Pss` (shared pages apportioned by mapping count), `Shared_Clean`/`Shared_Dirty`, and `Private_Clean`/`Private_Dirty`, plus `Size` when supplied by the kernel. Fields can be absent or inaccessible. Values are process-wide, change with runtime/library pages, and are accounting snapshots. They do not prove which specific page was copied. COW is generally handled when a protected private mapping is written and faults; kernel details vary. Virtual addresses and equal values do not prove physical sharing.

## Optional dashboard

On Ubuntu/WSL2, start the dashboard from the project root:

```sh
python backend/app.py
```

On Windows, open Ubuntu with `wsl -d Ubuntu`, then run:

```sh
cd "/mnt/d/os hack"
python3 backend/app.py
```

Open `http://127.0.0.1:5000` in the Windows browser. Set the parent's starting value and the child's write value, then click **Run Demonstration**. The button compiles `src/cow_demo.c` with a fixed GCC command and runs the fixed executable using the selected values. Values must be different bytes from 0 to 255. The Python standard-library server serves the page and API from one origin; it accepts only a page count from 1 to 4096, uses a 20-second timeout, prevents overlapping runs, and binds to loopback.

## Testing procedure

For the standalone C test, run the compile and execution commands above. For the full website test, start the backend, click **Run Demonstration**, then verify the parent keeps 42, the child changes to 90, and `/proc` measurements appear if available. Expected and actual results are in [tests/test-cases.md](tests/test-cases.md); scenarios not executed remain marked not run.

## Screenshots

Add dashboard screenshots here after running the project in Linux/WSL2. None have been captured in this environment.

## Known limitations

- Native Windows does not provide Linux `fork()` or `/proc`; use WSL2 Ubuntu or a Linux VM.
- Process-wide `smaps_rollup` values include unrelated mappings and are subject to kernel accounting, permissions, and timing.
- The web interface runs a one-page demonstration per click; the backend validates page counts up to 4096 for direct API use.
- This is a teaching aid, not a benchmark or a page-table tracing tool.

## Team contributions

Fill in team member names and contributions before submission.

## GitHub upload

```sh
git init
git add README.md PROJECT_REPORT.md src backend frontend tests requirements.txt .gitignore
git commit -m "Add Copy-on-Write memory demonstrator"
git branch -M main
git remote add origin https://github.com/USERNAME/REPOSITORY.git
git push -u origin main
```

## Seven-slide presentation outline

1. Title, course, team members.
2. Abstract and problem statement: why demonstrate COW.
3. `fork()`, virtual memory, and deferred copying.
4. Architecture and handshake: parent/child, page write, `/proc` snapshots.
5. C implementation and optional Python/HTML dashboard.
6. Tests, observed output, and screenshots (insert measurements from an actual Linux run).
7. Results, efficiency, limitations, and conclusion.

### Live demo speaking notes

“I initialize one page before `fork()`. The child reads 42, then writes 90 while the parent waits. The parent still reads 42, showing process isolation. The program samples both processes' `/proc` accounting before and after the write; these counters help us investigate memory behavior, but they cannot prove the identity of one copied physical page. Pages the child never writes can remain shared, which avoids unnecessary copying.”
