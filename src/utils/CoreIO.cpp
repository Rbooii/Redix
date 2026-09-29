#include "CoreDebug.hpp"
#include "CoreIO.hpp"
#include "CoreDB.hpp"

#include <unistd.h> 
#include <assert.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <unistd.h>
#include <stdio.h>
#include <stdlib.h>
#include <fcntl.h>
#include <errno.h>

#include <vector>
#include <unordered_map>
#include <algorithm>
#include <sstream>
#include <string>

/*
    read size byte -> n;
    read byte stream is transfered by read buffer pointer -> *buf
    loop acts so we read the full byte streams from connfd
    rv -> read as much byte as possible from stream [impossible for rv > n]
*/
int32_t read_full(int fd, char *buf, size_t n){
    while(n>0){
        ssize_t rv = read(fd, buf, n);
        if(rv<=0)return -1;
        assert((size_t)rv<=n);
        n-=(size_t)rv;
        buf+=rv;
    }
    return 0;
}

void conn_put(std::vector<Conn *> &fd2conn, Conn *conn){
    if(fd2conn.size() <= (size_t)conn->fd) fd2conn.resize(conn->fd + 1);
    fd2conn[conn->fd] = conn;
}

/*
    function yang merubah fd dari blocking -> nonblocking mode
*/
void fd_set_nb(int fd){
    errno = 0;
    int flags = fcntl(fd, F_GETFL, 0);
    if(errno){
        reportErrorMessage("fcntl error", 1);
        return;
    }
    flags |= O_NONBLOCK; //bitwise or
    errno = 0;
    (void)fcntl(fd, F_SETFL, flags);
    if(errno) reportErrorMessage("fcntl error", 1);
}

/*
    basically same with read_full() tapi instead of read we use -> write
*/
int32_t write_full(int fd, char *buf, size_t n){
    while(n>0){
        ssize_t rv = write(fd, buf, n);
        if(rv<=0)return -1;
        assert((size_t)rv<=n);
        n-=(size_t)rv;
        buf+=rv;
    }
    return 0;
}

int32_t accept_new_conn(std::vector<Conn *> &fd2conn, int fd){
    struct sockaddr_in client_addr = {};
    socklen_t socklen = sizeof(client_addr);
    int connfd = accept(fd, (struct sockaddr *)&client_addr, &socklen);
    if(connfd < 0){
        reportErrorMessage("accept Error", 0);
        return -1;
    }
    fd_set_nb(connfd); //set non blocking
    //Conn *conn = (Conn *)malloc(sizeof(Conn)); // init Conn struct
    Conn *conn = new Conn();
    conn->fd = connfd;
    conn->state = STATE_REQ;
    conn->rbuf_size = conn->wbuf_size = conn->wbuf_sent = 0;
    conn_put(fd2conn, conn);
    return 0;
}

void connection_io(Conn *conn){
    if(conn->state == STATE_REQ){
        state_req(conn);
    }else if(conn->state == STATE_RES){
        state_res(conn);
    }else{
        assert(0);
    }
}

/* READ */
void state_req(Conn *conn){
    while(try_fill_buffer(conn)){}
}


/*
    parse stream RESP 
    eg redis/redix CLI user type -> SET name arco
    server redis/redix CLI send stream ->  *3\r\n$3\r\nSET\r\n$4\r\nnama\r\n$4\r\narco\r\n
*/ 
int32_t find_crlf(const uint8_t *data, size_t len, size_t start_idx) {
    for (size_t i = start_idx; i + 1 < len; i++) {
        if (data[i] == '\r' && data[i+1] == '\n') {
            return i;
        }
    }
    return -1; 
}

int32_t parse_resp(const uint8_t *data, size_t len, std::vector<std::string> &out_cmd)
{
    if(len == 0) return 0;
    if(data[0] != '*') return -1;
    int32_t crlf_index = find_crlf(data, len, 0);
    if(crlf_index < 0) return 0;

    std::string array_len_str((char*)data + 1, crlf_index - 1);
    int num_args = std::stoi(array_len_str);
    size_t curr_pos = crlf_index + 2; //pass \r\n

    //loop trough all argument 
    for(int i = 0; i < num_args; i++){
        if(curr_pos >= len) return 0;
        if(data[curr_pos]!='$') return -1;
        int32_t next_crlf = find_crlf(data,len,curr_pos);
        if(next_crlf<0)return 0;

        std::string bulk_len_str((char*)data + curr_pos + 1, next_crlf - (curr_pos + 1));
        int bulk_len = std::stoi(bulk_len_str);

        curr_pos = next_crlf + 2;
        // CRITICAL: Cek apakah sisa buffer cukup untuk nampung Teks + \r\n
        if (curr_pos + bulk_len + 2 > len) {
            // Buffer kepotong di tengah jalan (TCP fragmentation). 
            // Return 0 biar CoreIO nunggu sisa paketnya dateng.
            return 0; 
        }
        
        //push ke command vector string
        out_cmd.push_back(std::string((char*)data + curr_pos, bulk_len));
        curr_pos += bulk_len + 2;
    }
    return curr_pos; // Balikin jumlah total byte yang udah sukses diproses
}


bool try_one_req(Conn *conn){
    // if(conn->rbuf_size < 4) return false; //not enough byte even for message info
    // uint32_t len = 0;
    // memcpy(&len, &conn->rbuf[0], 4);
    // if(len > MAX_MESSAGE_LEN){
    //     reportMessageNonError("Message too long!");
    //     conn->state = STATE_END;
    //     return false;
    // }
    // if(4+len > conn->rbuf_size) return false; //message di buffer belum lengkap lanjut next iter
    // printf("client Says : %.*s\n", len, &conn->rbuf[4]); // message buffer lengkap sizenya sama ama 4+len print message

    // std::string req_text((char*)&conn->rbuf[4], len);
    // std::vector<std::string> cmd = cmd_parse(req_text);
    // std::string res_text = cmd_exec(cmd);
    
    // uint32_t res_len = (uint32_t)res_text.size();
    // memcpy(&conn->wbuf[0], &res_len, 4);                  
    // memcpy(&conn->wbuf[4], res_text.data(), res_len);     
    // conn->wbuf_size = 4 + res_len;

    // size_t remain = conn->rbuf_size - 4 - len;
    // if(remain){
    //     memmove(conn->rbuf, &conn->rbuf[4+len], remain);
    // }
    // conn->rbuf_size = remain;

    // conn->state = STATE_RES;
    // state_res(conn);
    // return (conn->state == STATE_REQ);
    if(conn->rbuf_size == 0) return false;
    std::vector<std::string> cmd;
    int32_t consumed_byte_stream = parse_resp(
        conn->rbuf,
        conn->rbuf_size,
        cmd
    );

    if(consumed_byte_stream == 0){
        return false;
    }else if(consumed_byte_stream < 0){
        reportErrorMessage("BAD RESP FORMAT!",0);
        conn->state = STATE_END;
        return false;
    }

    std::string res_text = cmd_exec(cmd, conn);
    //feedback
    std::string op = cmd.empty() ? "" : cmd[0];
    std::transform(op.begin(), op.end(), op.begin(), ::tolower);
    printf("Client Command -> ");
    if(op == "auth") printf("AUTH ******\n");
    else {
        for(size_t x = 0; x < cmd.size(); x++){
            printf("%s ", cmd[x].c_str());
        }
    }
    printf("\n Server Response -> %s", res_text.c_str());


    //respond
    uint32_t res_len = (uint32_t)res_text.size();
    memcpy(&conn->wbuf[0], res_text.data(), res_len);
    conn->wbuf_size = res_len;

    // Geser sisa buffer (kalau ternyata client ngirim >1 command sekaligus/pipelining)
    size_t remain = conn->rbuf_size - consumed_byte_stream;
    if (remain > 0) {
        memmove(conn->rbuf, &conn->rbuf[consumed_byte_stream], remain);
    }
    conn->rbuf_size = remain;
    conn->state = STATE_RES;
    state_res(conn);
    return (conn->state == STATE_REQ);
}

bool try_fill_buffer(Conn *conn){
    assert(conn->rbuf_size < sizeof(conn->rbuf));
    ssize_t rv = 0;
    do {
        size_t cap = sizeof(conn->rbuf) - conn->rbuf_size;
        rv = read(conn->fd, &conn->rbuf[conn->rbuf_size], cap);
    }while ( rv < 0 && errno == EINTR);

    if(rv < 0 && errno == EAGAIN) return false;
    if(rv < 0){
        reportMessageNonError("read error!");
        conn->state = STATE_END;
        return false;
    }
    if(rv == 0){
        if(conn->rbuf_size > 0){
            reportMessageNonError("unexpected EOF");
        }else{
            reportMessageNonError("EOF");
        }
        conn->state = STATE_END;
        return false;
    }

    conn->rbuf_size += (size_t)rv;
    assert(conn->rbuf_size <= sizeof(conn->rbuf));
    while(try_one_req(conn)){}
    return (conn->state == STATE_REQ);
}

bool try_flush_buffer(Conn *conn){
    ssize_t rv = 0;
    do {
        size_t remain = conn->wbuf_size - conn->wbuf_sent;
        rv = write(conn->fd, &conn->wbuf[conn->wbuf_sent], remain);
    } while (rv < 0 && errno == EINTR);
    if(rv < 0 && errno==EAGAIN) return false;
        if(rv < 0) {
            reportErrorMessage("write error", 0);
            conn->state = STATE_END;
            return false;
        }
        conn->wbuf_sent += (size_t)rv;
        assert(conn->wbuf_sent <= conn->wbuf_size);
        if(conn->wbuf_sent == conn->wbuf_size){
            //full data ke stream
            conn->state = STATE_REQ;
            conn->wbuf_sent = 0;
            conn->wbuf_size = 0;
            return false;
        }
    return true;
}

void state_res(Conn *conn){
    while(try_flush_buffer(conn)){}
}

