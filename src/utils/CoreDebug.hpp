#ifndef COREDEBUG_H
#define COREDEBUG_H

#include <stdint.h> 
#include <string>
#include <vector>

typedef struct ServerFlags{
    std::string flag;
    std::string flagValue;
} ServerFlags;

void reportErrorMessage(const char *str, uint16_t end);
void reportMessageNonError(const char *str);
void printASCII();
std::vector<ServerFlags> serverCLIArgsCheck(int argc, char *argv[]);
void ApplyCLIFlags(const std::vector<ServerFlags> &FLAGS,
     uint16_t &PORT,
     bool &resetAOF);

#endif