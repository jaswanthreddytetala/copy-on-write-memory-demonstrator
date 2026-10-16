#define _GNU_SOURCE
#include <errno.h>
#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>

/* A small, page-aligned mapping makes the write target easy to reason about.
 * Pipes keep both processes alive at observation points so /proc can inspect
 * them. Virtual addresses and values alone do not prove physical page sharing.
 */
static int write_byte(int fd, char value) {
    ssize_t n;
    do { n = write(fd, &value, 1); } while (n < 0 && errno == EINTR);
    return n == 1 ? 0 : -1;
}

static int read_byte(int fd, char *value) {
    ssize_t n;
    do { n = read(fd, value, 1); } while (n < 0 && errno == EINTR);
    return n == 1 ? 0 : -1;
}

static int parse_byte(const char *text, unsigned long *value) {
    char *end = NULL;
    errno = 0;
    unsigned long parsed = strtoul(text, &end, 10);
    if (errno || end == text || *end || parsed > 255) return -1;
    *value = parsed;
    return 0;
}

static void show_rollup(pid_t pid, const char *label) {
    char path[128], line[256];
    snprintf(path, sizeof path, "/proc/%ld/smaps_rollup", (long)pid);
    FILE *f = fopen(path, "r");
    if (!f) {
        printf("  %s: unavailable (%s)\n", label, strerror(errno));
        return;
    }
    printf("  %s (/proc/%ld/smaps_rollup, kB):\n", label, (long)pid);
    const char *keys[] = {"Rss:", "Pss:", "Shared_Clean:", "Shared_Dirty:",
                          "Private_Clean:", "Private_Dirty:", "Size:"};
    while (fgets(line, sizeof line, f))
        for (size_t i = 0; i < sizeof keys / sizeof keys[0]; ++i)
            if (!strncmp(line, keys[i], strlen(keys[i]))) printf("    %s", line);
    fclose(f);
}

static void stats(pid_t parent, pid_t child, const char *phase) {
    printf("\n[Observation: %s]\n", phase);
    show_rollup(parent, "parent");
    show_rollup(child, "child");
    puts("  Note: process-wide accounting; kernel and permissions affect availability.");
    fflush(stdout);
}

int main(int argc, char **argv) {
    size_t pages = 1;
    unsigned long initial_value = 0x2A, child_value = 0x5A;
    if (argc == 2 || argc == 4) {
        char *end = NULL;
        errno = 0;
        unsigned long parsed = strtoul(argv[1], &end, 10);
        if (errno || !end || *end || parsed < 1 || parsed > 4096) {
            fprintf(stderr, "Usage: %s [pages: 1..4096 [parent_value child_value: 0..255]]\n", argv[0]);
            return 2;
        }
        pages = (size_t)parsed;
    } else if (argc != 1) {
        fprintf(stderr, "Usage: %s [pages: 1..4096 [parent_value child_value: 0..255]]\n", argv[0]);
        return 2;
    }
    if (argc == 4 && (parse_byte(argv[2], &initial_value) ||
                      parse_byte(argv[3], &child_value) || initial_value == child_value)) {
        fprintf(stderr, "Parent and child values must be different integers from 0 to 255.\n");
        return 2;
    }
    unsigned char initial_byte = (unsigned char)initial_value;
    unsigned char child_byte = (unsigned char)child_value;
    long page_size = sysconf(_SC_PAGESIZE);
    if (page_size <= 0 || pages > SIZE_MAX / (size_t)page_size) {
        fputs("Could not determine a safe page-aligned allocation size.\n", stderr);
        return 1;
    }
    size_t bytes = pages * (size_t)page_size;
    volatile unsigned char *region = mmap(NULL, bytes, PROT_READ | PROT_WRITE,
            MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
    if (region == MAP_FAILED) { perror("mmap"); return 1; }
    for (size_t i = 0; i < pages; ++i) region[i * (size_t)page_size] = initial_byte;

    int parent_to_child[2], child_to_parent[2];
    if (pipe(parent_to_child) || pipe(child_to_parent)) {
        perror("pipe"); munmap((void *)region, bytes); return 1;
    }
    pid_t parent = getpid();
    printf("Copy-on-Write Memory Demonstrator\nParent PID: %ld\nPages: %zu (%zu bytes)\nInitial value at each page: %u\n",
           (long)parent, pages, bytes, (unsigned)region[0]);
    fflush(stdout);
    pid_t child = fork();
    if (child < 0) { perror("fork"); munmap((void *)region, bytes); return 1; }
    if (child == 0) {
        close(parent_to_child[1]); close(child_to_parent[0]);
        printf("Child PID: %ld (parent %ld)\nChild reads initial value: %u\n",
               (long)getpid(), (long)getppid(), (unsigned)region[0]); fflush(stdout);
        if (write_byte(child_to_parent[1], 'R') || read_byte(parent_to_child[0], &(char){0})) _exit(3);
        for (size_t i = 0; i < pages; ++i) region[i * (size_t)page_size] = child_byte;
        printf("Child modified %zu page location(s); value now: %u\n", pages, (unsigned)region[0]); fflush(stdout);
        if (write_byte(child_to_parent[1], 'W') || read_byte(parent_to_child[0], &(char){0})) _exit(4);
        printf("Child final value: %u\n", (unsigned)region[0]); fflush(stdout);
        close(parent_to_child[0]); close(child_to_parent[1]); munmap((void *)region, bytes); _exit(0);
    }
    close(parent_to_child[0]); close(child_to_parent[1]);
    char signal;
    if (read_byte(child_to_parent[0], &signal)) { perror("child handshake"); }
    printf("\nParent observes before child write: %u\n", (unsigned)region[0]);
    stats(parent, child, "after fork, before child write");
    if (write_byte(parent_to_child[1], 'G') || read_byte(child_to_parent[0], &signal)) perror("child handshake");
    printf("Parent value after child write: %u (unchanged)\n", (unsigned)region[0]);
    stats(parent, child, "after child write");
    if (write_byte(parent_to_child[1], 'G')) perror("child release");
    int status = -1;
    while (waitpid(child, &status, 0) < 0) { if (errno != EINTR) { perror("waitpid"); break; } }
    printf("Result: parent PID %ld retains %u; child PID %ld wrote %u.\n",
           (long)parent, (unsigned)region[0], (long)child, (unsigned)child_byte);
    puts("A child write to a private mapping typically triggers COW; values demonstrate process isolation, while smaps is accounting evidence, not proof of a specific copy event.");
    close(parent_to_child[1]); close(child_to_parent[0]); munmap((void *)region, bytes);
    return WIFEXITED(status) && WEXITSTATUS(status) == 0 ? 0 : 1;
}
