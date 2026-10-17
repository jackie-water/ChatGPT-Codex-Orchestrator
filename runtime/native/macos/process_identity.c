#include <errno.h>
#include <inttypes.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/proc_info.h>
#include <libproc.h>

enum {
    EXIT_OK = 0,
    EXIT_INVALID_PID = 64,
    EXIT_SHORT_READ = 65,
    EXIT_MISSING = 66,
    EXIT_PERMISSION = 77,
    EXIT_UNSUPPORTED_RESULT = 69,
    EXIT_UNEXPECTED = 70
};

static int emit_error(const char *status, int pid, int error_number, int exit_code) {
    if (error_number != 0) {
        printf("{\"status\":\"%s\",\"pid\":%d,\"errno\":%d}\n", status, pid, error_number);
    } else {
        printf("{\"status\":\"%s\",\"pid\":%d}\n", status, pid);
    }
    return exit_code;
}

static int parse_pid(const char *text, int *pid_out) {
    char *end = NULL;
    unsigned long value;
    if (text == NULL || text[0] == '\0' || text[0] == '-' || text[0] == '+') return 0;
    errno = 0;
    value = strtoul(text, &end, 10);
    if (errno == ERANGE || end == text || *end != '\0' || value == 0 || value > INT_MAX) return 0;
    *pid_out = (int)value;
    return 1;
}

int main(int argc, char **argv) {
    struct proc_bsdinfo info;
    int pid;
    int result;

    if (argc != 2 || !parse_pid(argv[1], &pid)) {
        return emit_error("INVALID_PID", 0, EINVAL, EXIT_INVALID_PID);
    }
    memset(&info, 0, sizeof(info));
    errno = 0;
    result = proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, (int)sizeof(info));
    if (result < 0) {
        if (errno == ESRCH) return emit_error("MISSING", pid, errno, EXIT_MISSING);
        if (errno == EPERM || errno == EACCES) return emit_error("PERMISSION_DENIED", pid, errno, EXIT_PERMISSION);
        return emit_error("UNEXPECTED_ERROR", pid, errno, EXIT_UNEXPECTED);
    }
    if (result == 0) {
        if (errno == ESRCH) return emit_error("MISSING", pid, errno, EXIT_MISSING);
        if (errno == EPERM || errno == EACCES) return emit_error("PERMISSION_DENIED", pid, errno, EXIT_PERMISSION);
        return emit_error("SHORT_READ", pid, errno, EXIT_SHORT_READ);
    }
    if (result != (int)sizeof(info)) return emit_error("SHORT_READ", pid, 0, EXIT_SHORT_READ);
    if (info.pbi_start_tvusec >= 1000000ULL) return emit_error("INVALID_TIMESTAMP", pid, 0, EXIT_UNSUPPORTED_RESULT);
    printf("{\"status\":\"OK\",\"pid\":%d,\"start_sec\":%" PRIu64 ",\"start_usec\":%" PRIu64 "}\n",
           pid, info.pbi_start_tvsec, info.pbi_start_tvusec);
    return EXIT_OK;
}
