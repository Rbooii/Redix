#include "CoreEventLoop.hpp"

#include <unistd.h>

#ifdef __linux__
#ifndef EPOLLRDHUP
#define EPOLLRDHUP 0x2000
#endif
#endif

EventLoop::EventLoop() = default;

EventLoop::~EventLoop()
{
    close_loop();
}

bool EventLoop::init()
{
    if (loop_fd != -1)
        return true;

#ifdef __linux__
    loop_fd = epoll_create1(EPOLL_CLOEXEC);
#else
    loop_fd = kqueue();
#endif

    return loop_fd != -1;
}

bool EventLoop::add(int fd)
{
    if (loop_fd == -1 || fd < 0)
        return false;

#ifdef __linux__
    struct epoll_event event = {};
    event.events = EPOLLIN;
    event.data.fd = fd;
    return epoll_ctl(loop_fd, EPOLL_CTL_ADD, fd, &event) == 0;
#else
    struct kevent change;
    EV_SET(&change, fd, EVFILT_READ, EV_ADD | EV_ENABLE, 0, 0, nullptr);
    return kevent(loop_fd, &change, 1, nullptr, 0, nullptr) != -1;
#endif
}

bool EventLoop::set_read(int fd)
{
    if (loop_fd == -1 || fd < 0)
        return false;

#ifdef __linux__
    struct epoll_event event = {};
    event.events = EPOLLIN;
    event.data.fd = fd;
    return epoll_ctl(loop_fd, EPOLL_CTL_MOD, fd, &event) == 0;
#else
    struct kevent changes[2];
    EV_SET(&changes[0], fd, EVFILT_WRITE, EV_DISABLE, 0, 0, nullptr);
    EV_SET(&changes[1], fd, EVFILT_READ, EV_ADD | EV_ENABLE, 0, 0, nullptr);
    return kevent(loop_fd, changes, 2, nullptr, 0, nullptr) != -1;
#endif
}

bool EventLoop::set_write(int fd)
{
    if (loop_fd == -1 || fd < 0)
        return false;

#ifdef __linux__
    struct epoll_event event = {};
    event.events = EPOLLOUT;
    event.data.fd = fd;
    return epoll_ctl(loop_fd, EPOLL_CTL_MOD, fd, &event) == 0;
#else
    struct kevent changes[2];
    EV_SET(&changes[0], fd, EVFILT_READ, EV_DISABLE, 0, 0, nullptr);
    EV_SET(&changes[1], fd, EVFILT_WRITE, EV_ADD | EV_ENABLE, 0, 0, nullptr);
    return kevent(loop_fd, changes, 2, nullptr, 0, nullptr) != -1;
#endif
}

int EventLoop::wait(std::vector<PollEvent> &events, int timeout_ms)
{
    if (loop_fd == -1)
        return -1;

    size_t capacity = events.size();
    if (capacity > (size_t)MAX_NATIVE_EVENTS)
        capacity = MAX_NATIVE_EVENTS;
    if (capacity == 0)
        return 0;

#ifdef __linux__
    int ready = epoll_wait(loop_fd, native_events, (int)capacity, timeout_ms);
    if (ready < 0)
        return -1;

    for (int i = 0; i < ready; i++)
    {
        events[i].fd = native_events[i].data.fd;
        events[i].eof =
            (native_events[i].events & (EPOLLHUP | EPOLLERR | EPOLLRDHUP)) != 0;
    }
    return ready;
#else
    struct timespec timeout = {};
    struct timespec *timeout_ptr = &timeout;
    if (timeout_ms < 0)
    {
        timeout_ptr = nullptr;
    }
    else
    {
        timeout.tv_sec = timeout_ms / 1000;
        timeout.tv_nsec = (timeout_ms % 1000) * 1000000L;
    }

    int ready = kevent(loop_fd, nullptr, 0, native_events, (int)capacity, timeout_ptr);
    if (ready < 0)
        return -1;

    for (int i = 0; i < ready; i++)
    {
        events[i].fd = (int)native_events[i].ident;
        events[i].eof = (native_events[i].flags & EV_EOF) != 0;
    }
    return ready;
#endif
}

void EventLoop::close_loop()
{
    if (loop_fd == -1)
        return;

    close(loop_fd);
    loop_fd = -1;
}
