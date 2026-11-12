#ifndef COREEVENTLOOP_H
#define COREEVENTLOOP_H

#include <vector>

#ifdef __linux__
#include <sys/epoll.h>
#else
#include <sys/event.h>
#endif

struct PollEvent
{
    int fd = -1;
    bool eof = false;
};

class EventLoop
{
public:
    EventLoop();
    ~EventLoop();

    EventLoop(const EventLoop &) = delete;
    EventLoop &operator=(const EventLoop &) = delete;

    bool init();
    bool add(int fd);
    bool set_read(int fd);
    bool set_write(int fd);
    int wait(std::vector<PollEvent> &events, int timeout_ms);
    void close_loop();

private:
    enum
    {
        MAX_NATIVE_EVENTS = 1024
    };

    int loop_fd = -1;

#ifdef __linux__
    struct epoll_event native_events[MAX_NATIVE_EVENTS];
#else
    struct kevent native_events[MAX_NATIVE_EVENTS];
#endif
};

#endif
