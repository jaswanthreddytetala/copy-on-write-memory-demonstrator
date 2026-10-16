# Test cases and results

Run the commands in the README on Linux/Ubuntu or WSL2. Linux build and one-page execution were performed in Ubuntu WSL during this session. Other scenarios remain unrun until explicitly exercised.

| ID | Test | Expected result | Actual result |
|---|---|---|---|
| T1 | Compile with `gcc -Wall -Wextra -O0 src/cow_demo.c -o cow_demo` | No errors or warnings | Passed in Ubuntu WSL; compiled with no diagnostics |
| T2 | Run `./cow_demo` | Parent/child PIDs, initial 42, child 90, parent remains 42 | Passed in Ubuntu WSL: parent PID 488 retained 42; child PID 489 read 42 and wrote 90; exit code 0 |
| T3 | Run `./cow_demo 8` | Eight initialized page locations; child writes each, parent's first remains 42 | Not run |
| T4 | Inspect output for exit/result | Child exits and parent completes `waitpid` | Passed in the T2 run: final result printed; exit code 0 |
| T5 | Force allocation/fork failure (resource constrained environment) | Clear `mmap`/`fork` error and nonzero exit; practical resource fault injection is environment dependent | Not run |
| T6 | Repeat `./cow_demo` several times | Each run completes independently | Not run |
| T7 | Restrict `/proc` access or use a kernel without `smaps_rollup` | Demo still prints values; observation says unavailable | Not run under restricted conditions; available in Ubuntu WSL and returned Rss/Pss/shared/private counters |
| T8 | POST invalid inputs (page count out of range, value out of range, equal values) | HTTP 400; C program is not launched | `pages: 0`, equal values, and a byte value of 300 returned HTTP 400 |
| T9 | Backend timeout / executable failure | HTTP 504 / 500 with bounded output | Not run |
| T10 | Compare smaps before/after write | Accounting may change; no assertion that totals prove a specific page-copy event | Not run |
| T11 | Run from dashboard API, including fixed compile step | Actual output, parent 42, child 90, two `/proc` phases | Passed via localhost API in Ubuntu WSL: `ok=true`, values 42/90, two observation phases; page served HTTP 200 |
| T12 | Set custom values (for example 17 and 203) | C output and result cards reflect the selected byte values | Passed via localhost API in Ubuntu WSL: parent 17, child 203 |

The local Python backend accepts only a bounded page count, compiles the fixed C source, and invokes the resulting executable without a shell. It is localhost-only by default.
