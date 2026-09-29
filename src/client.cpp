#include "CoreDebug.hpp"
#include "CoreIO.hpp"
#include <netinet/in.h>
#include <sstream>
#include <stdio.h>
#include <stdlib.h>
#include <string>
#include <sys/socket.h>
#include <unistd.h>
#include <vector>

#define MAX_MESSAGE_LEN 4096
/*
LEGACY REQ-RES CODE
    char msg[] = "Hello this is from client!";
    if(argv[2]){
        strcpy(msg, argv[2]);
    }
    write(fd, msg, strlen(msg));

    //read server message
    char read_buff[64] = {};
    ssize_t n = read(fd, read_buff, sizeof(read_buff)-1);
    if(n<0){
        reportErrorMessage("read() err!",0);
        return 1;
    }
    printf("Server Message : %s\n", read_buff);
*/

std::string plain_to_resp(const std::string &input) {
  std::vector<std::string> tokens;
  std::stringstream ss(input);
  std::string word;

  while (ss >> word) {
    tokens.push_back(word);
  }

  if (tokens.empty())
    return "";
  std::string resp = "*" + std::to_string(tokens.size()) + "\r\n";

  // Bungkus setiap kata jadi Bulk String ($<panjang_kata>\r\n<kata>\r\n)
  for (const std::string &token : tokens) {
    resp += "$" + std::to_string(token.length()) + "\r\n" + token + "\r\n";
  }

  return resp;
}

static int32_t query(int fd, const char *text) {
  std::string resp_msg = plain_to_resp(text);
  if (resp_msg.empty())
    return 0;

  if (resp_msg.size() > MAX_MESSAGE_LEN) {
    reportErrorMessage("Message stream too long", 0);
    return -1;
  }

  int32_t err = write_full(fd, (char *)resp_msg.c_str(), resp_msg.size());
  if (err) {
    reportErrorMessage("Error sending message to server", 0);
    return err;
  }

  char read_buff[MAX_MESSAGE_LEN + 1] = {};
  ssize_t n = read(fd, read_buff, sizeof(read_buff) - 1);

  if (n < 0) {
    reportErrorMessage("read stream error", 0);
    return -1;
  } else if (n == 0) {
    reportErrorMessage("EOF (Server Closed)", 0);
    return -1;
  }

  read_buff[n] = '\0';

  printf("Message From Server : %s", read_buff);
  return 0;
}

int main(int argc, char *argv[]) {
  // args -> [1] *server port to connect;
  if (argc < 2) {
    reportErrorMessage("NO PORT SPECIFIED!", 0);
    return 1;
  }

  int server_port = atoi(argv[1]);
  printf("Connected to REDIX Server port -> %d \n", server_port);

  int fd = socket(AF_INET, SOCK_STREAM, 0);
  if (fd < 0)
    reportErrorMessage("Failed to create FD", 1);
  printf("Socket Created!\n");

  // connect to server
  struct sockaddr_in server_addr = {};
  server_addr.sin_family = AF_INET;
  server_addr.sin_port = htons(server_port);
  server_addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  int rv =
      connect(fd, (const struct sockaddr *)&server_addr, sizeof(server_addr));
  if (rv)
    reportErrorMessage("Failed to Connect Port", 1);

  while (1) {
    char message[MAX_MESSAGE_LEN];
    printf("[PORT : %d] REDIX CLI > ", atoi(argv[1]));
    if (fgets(message, sizeof(message), stdin) == NULL) {
      printf("\nClient Stopped.\n");
      break;
    }
    message[strcspn(message, "\n")] = 0;
    if (strlen(message) == 0)
      continue;
    int32_t err = query(fd, message);
    if (err) {
      reportErrorMessage("Query Failed", 0);
      break;
    }
  }

  return 0;
}
