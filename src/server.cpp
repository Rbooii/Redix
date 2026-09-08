#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <unistd.h>
#include <assert.h>
#include <errno.h>
#include <fcntl.h>
#include <vector>
#include <sys/event.h> 

//Core-Header
#include "CoreDebug.hpp"
#include "CoreIO.hpp"
#include "CoreDB.hpp" 

#define PORT 3333
#define MAX_EVENTS 1024 

int main(void){
    printASCII();
    printf("Server code running at port:%d...\n", PORT);

    int fd = socket(AF_INET, SOCK_STREAM, 0);
    if(fd < 0) reportErrorMessage("Failed to create FD", 1);
    printf("Socket Created!\n");
    
    int val = 1;
    setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &val, sizeof(val));

    struct sockaddr_in server_addr = {};
    server_addr.sin_family = AF_INET;
    server_addr.sin_port = htons(PORT);
    server_addr.sin_addr.s_addr = htonl(0);
    int rv = bind(fd, (const struct sockaddr *)&server_addr, sizeof(server_addr));
    if(rv) reportErrorMessage("Failed to Bind Port", 1);

    rv = listen(fd, SOMAXCONN);
    if(rv) reportErrorMessage("Failed to Listen", 1);

    std::vector<Conn *> fd2conn;
    fd_set_nb(fd); 

    int kq = kqueue();
    if (kq == -1) reportErrorMessage("kqueue creation failed", 1);

    struct kevent change_event;
    EV_SET(&change_event, fd, EVFILT_READ, EV_ADD | EV_ENABLE, 0, 0, NULL);
    if (kevent(kq, &change_event, 1, NULL, 0, NULL) == -1) {
        reportErrorMessage("kevent initial registration failed", 1);
    }
    
    struct kevent event_list[MAX_EVENTS]; // Buffer penampung event yang meledak

    printf("Redix kqueue event loop started!\n");

    while(1){
        // Setup timeout untuk kevent
        struct timespec timeout;
        timeout.tv_sec = 1;
        timeout.tv_nsec = 0;

        // kqueue ngeblock disini sampai ada I/O atau timeout 1 detik
        int nev = kevent(kq, NULL, 0, event_list, MAX_EVENTS, &timeout);
        
        if(nev < 0){
            reportErrorMessage("kevent polling error", 1);
        }

        for (int i = 0; i < nev; i++) {
            int current_fd = event_list[i].ident;

            if (current_fd == fd) {
                // Event di main socket Ada koneksi baru yg minta masuk
                int32_t accept_status = accept_new_conn(fd2conn, fd);
                if (accept_status == 0) {
                    for(int idx = fd2conn.size() - 1; idx >= 0; idx--) {
                        if (fd2conn[idx] && fd2conn[idx]->state == STATE_REQ) {
                            int new_client_fd = fd2conn[idx]->fd;
                            // Daftarkan socket client baru ini ke kqueue
                            struct kevent client_event;
                            EV_SET(&client_event, new_client_fd, EVFILT_READ, EV_ADD | EV_ENABLE, 0, 0, NULL);
                            kevent(kq, &client_event, 1, NULL, 0, NULL);
                            break;
                        }
                    }
                }
            } else {
                // Event di socket client (Read/Write)
                Conn *conn = fd2conn[current_fd];
                if (!conn) continue;
                
                // Kalau ada event EOF (client disconnect)
                if (event_list[i].flags & EV_EOF) {
                    conn->state = STATE_END;
                } else {
                    connection_io(conn); // Lanjut baca/tulis state biasa
                }
                
                // Cek state untuk ganti monitor Read atau Write di putaran berikutnya
                if (conn->state == STATE_RES) {
                    // Berhenti monitor READ, mulai monitor WRITE
                    struct kevent modify_event[2];
                    EV_SET(&modify_event[0], current_fd, EVFILT_READ, EV_DISABLE, 0, 0, NULL);
                    EV_SET(&modify_event[1], current_fd, EVFILT_WRITE, EV_ADD | EV_ENABLE, 0, 0, NULL);
                    kevent(kq, modify_event, 2, NULL, 0, NULL);
                } else if (conn->state == STATE_REQ) {
                    // Berhenti monitor WRITE, kembali monitor READ
                    struct kevent modify_event[2];
                    EV_SET(&modify_event[0], current_fd, EVFILT_WRITE, EV_DISABLE, 0, 0, NULL);
                    EV_SET(&modify_event[1], current_fd, EVFILT_READ, EV_ENABLE, 0, 0, NULL);
                    kevent(kq, modify_event, 2, NULL, 0, NULL);
                }

                if(conn->state == STATE_END){
                    // Client putus. kqueue otomatis ngehapus fd yang di-close dari pantauan
                    fd2conn[conn->fd] = NULL;
                    (void)close(conn->fd);
                    delete(conn);
                }
            }
        }

        main_thread_process_ttl(100); 
    }

    return 0;
}