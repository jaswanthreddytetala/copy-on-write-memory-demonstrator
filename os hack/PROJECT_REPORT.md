# Copy-on-Write Memory Demonstrator — Project Report

## 1. Abstract

This project demonstrates Linux process creation and Copy-on-Write (COW) using a page-aligned memory mapping initialized before `fork()`. A child reads and modifies the mapping while the parent remains blocked at synchronization points. The parent subsequently reads its original value. The program also samples Linux `/proc/<pid>/smaps_rollup` accounting when available, and an optional local Python dashboard displays actual program output. Accounting is presented as evidence for investigation, not proof of a particular page-copy event.

## 2. Introduction

`fork()` creates a child process with a separate virtual address space derived from the parent's. Linux can initially back corresponding private mappings with shared physical pages and defer copying until a write requires a private version. This reduces unnecessary memory copying when a child reads or replaces data soon after creation.

## 3. Problem statement

The mechanics of COW are difficult to observe directly in a classroom: identical virtual addresses and values are not evidence of shared physical memory. A demonstration should show process isolation and expose available kernel accounting without overstating what those measurements prove.

## 4. Objectives

- Create parent and child processes with `fork()`.
- Initialize a page-aligned private region before the fork.
- Synchronize observations around a child write.
- Show independent values and correct child reaping.
- Report relevant `/proc` counters when supported.
- Provide an optional dashboard that distinguishes execution results from conceptual explanation.

## 5. Existing and proposed systems

An explanation-only approach describes COW but gives no running process evidence. The proposed system couples a standalone C program with coordinated `/proc` snapshots. An optional local dashboard invokes only that executable through a constrained API.

## 6. System architecture

`cow_demo.c` allocates a private anonymous mapping and initializes one byte per selected page. Two pipes coordinate the parent and child. The parent collects counters while both processes wait, releases the child to write, then collects a second snapshot. The child exits and the parent calls `waitpid`. The local dashboard is a Python standard-library presentation layer; it does not replace the C execution.

## 7. Algorithms and workflow

1. Validate the optional page count and determine the system page size.
2. Allocate a page-aligned `MAP_PRIVATE | MAP_ANONYMOUS` mapping and initialize it.
3. Create synchronization pipes and call `fork()`.
4. Child reports the initial value and waits for the parent.
5. Parent records process accounting and releases the child.
6. Child writes a different value to each selected page location and signals completion.
7. Parent confirms its original value and samples accounting again.
8. Parent releases and reaps the child, then reports both values.

## 8. Implementation details

The core is `src/cow_demo.c`. `mmap()` provides page-aligned storage; `pipe()` provides a deterministic two-phase rendezvous; `waitpid()` handles child completion and retries interrupted waits. The observer reads `Rss`, `Pss`, shared/private clean and dirty counters, and `Size` from `smaps_rollup`. The frontend labels its page diagram illustrative because process-wide counters do not associate a measured physical page with this specific mapping.

The optional standard-library HTTP API validates a bounded integer, compiles a fixed source with fixed GCC arguments, invokes the fixed executable without a shell, rejects concurrent runs, applies 20-second build and execution timeouts, caps response output, serves only frontend files under its fixed directory, and binds to loopback. It exposes no arbitrary command or file endpoint.

## 9. Technologies

C, Linux system calls (`mmap`, `fork`, `pipe`, `waitpid`), Linux procfs, Python 3 standard library, HTML, CSS, and JavaScript.

## 10. Testing and results

See `tests/test-cases.md` for eleven functional, failure, and observation scenarios. Linux compilation, standalone execution, and the dashboard API workflow were run in Ubuntu WSL; unavailable scenarios are marked not run. The web page and static assets returned HTTP 200, the dashboard API returned parent value 42 and child value 90 with two procfs observations, and invalid page input returned HTTP 400.

## 11. Advantages and limitations

The program is small, runnable independently, and demonstrates parent/child value isolation with clear synchronization. Multiple pages can be selected for a larger write set. `/proc` fields are useful accounting information but are process-wide, kernel-dependent, timing-sensitive, and not a page-level trace. `smaps_rollup` may be unavailable or restricted. The frontend requires a locally started backend for actual results.

## 12. Future enhancements

Add an optional mapping-specific pagemap investigation with explicit privilege and kernel limitations, expose validated page counts in the interface, archive run metadata, and provide a measured Linux test screenshot.

## 13. Conclusion

The demonstrator shows that a child can modify its post-fork memory while the parent retains its original value. It gathers actual memory-accounting snapshots where available and keeps the distinction between process-level evidence and proof of a page-level COW event clear.

## 14. References

- Linux man-pages project: `fork(2)`, `mmap(2)`, `waitpid(2)`, `proc(5)`, and `proc_pid_smaps(5)`.
- Linux kernel documentation: `/proc` filesystem and memory-management documentation.
- GCC documentation: compiler options and C language support.
