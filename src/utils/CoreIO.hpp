#ifndef COREIO_H
#define COREIO_H

#include <stdint.h>
#include <stddef.h> 
#include <vector>
#include <assert.h>

enum {
    STATE_REQ = 0,
    STATE_RES = 1,
    STATE_END = 2,
};

const int MAX_MESSAGE_LEN = 4096;

typedef struct Conn {
    int fd = -1;
    uint32_t state = 0;
    size_t rbuf_size = 0;
    uint8_t rbuf[4+MAX_MESSAGE_LEN];
    size_t wbuf_size = 0;
    size_t wbuf_sent = 0;
    uint8_t wbuf[4+MAX_MESSAGE_LEN];
    bool authenticated = false;
} Conn ;

int32_t read_full(int fd, char *buf, size_t n);
int32_t write_full(int fd, char *buf, size_t n);
int32_t accept_new_conn(std::vector<Conn *> &fd2conn, int fd);
int32_t parse_resp(const uint8_t *data, size_t len, std::vector<std::string> &out_cmd);

void conn_put(std::vector<Conn *> &fd2conn, Conn *conn);
void fd_set_nb(int fd);
void connection_io(Conn *conn);
void state_req(Conn *conn);
void state_res(Conn *conn);

bool try_fill_buffer(Conn *conn);
bool try_one_req(Conn *conn);
bool try_flush_buffer(Conn *conn);
#endif