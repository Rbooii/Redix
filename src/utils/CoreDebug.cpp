#include "CoreDebug.hpp" 
#include "CoreDB.hpp"
#include <cstdio>     
#include <cstdlib>   
#include <charconv>
#include <string>
#include <vector>
#include <iostream>

void reportErrorMessage(const char *str, uint16_t end){
    printf("Error -> %s\n", str);
    if(end == 1){
        printf("Aborted!\n");
        abort();
    }
}

void reportMessageNonError(const char *str){
    printf("Message -> %s\n", str);
}


//struktur cmd -flag flag_value -flag2 flag2_value
std::vector<ServerFlags> serverCLIArgsCheck(int argc, char *argv[]){
    std::vector<ServerFlags> flags;

    for(int i = 1; i < argc; i++){
        std::string token = argv[i];
        if(token.empty() || token[0] != '-'){
            reportMessageNonError(("Ignoring stray argument: " + token).c_str());
            continue;
        }

        ServerFlags currentFlag;
        currentFlag.flag = token;

        //flag boolean (mis. -r) tidak punya value, ambil value hanya kalau token berikutnya bukan flag
        if(i + 1 < argc && argv[i + 1][0] != '-'){
            currentFlag.flagValue = argv[++i];
        }

        flags.push_back(currentFlag);
    }

    return flags;
}

void ApplyCLIFlags(const std::vector<ServerFlags> &FLAGS,
     uint16_t &PORT,
     bool &resetAOF
){
    for(const auto &flag : FLAGS){
        if(flag.flag == "-p"){
            if(flag.flagValue.empty()){
                reportErrorMessage("Missing value for -p (expected 1-65535)", 1);
            }

            int port = 0;
            const char *begin = flag.flagValue.data();
            const char *end = begin + flag.flagValue.size();
            std::from_chars_result result = std::from_chars(begin, end, port);

            if(result.ec != std::errc() || result.ptr != end || port < 1 || port > 65535){
                reportErrorMessage(("Invalid port value for -p: " + flag.flagValue).c_str(), 1);
            }

            PORT = (uint16_t)port;
        }
        else if(flag.flag == "-r"){
            if(flag.flagValue.empty() || flag.flagValue == "1"){
                resetAOF = true;
            }
            else if(flag.flagValue == "0"){
                resetAOF = false;
            }
            else{
                reportErrorMessage(("Invalid value for -r (expected 0/1): " + flag.flagValue).c_str(), 1);
            }
        }
        else if(flag.flag == "-d"){
            if(flag.flagValue.empty()){
                reportErrorMessage("Missing value for -d (expected PATH to presistance folder)", 1);
            }
            std::string path = flag.flagValue;
            AOF_PATH = path;
            AOF_TEMP = path + ".tmp";
        }
        else if(flag.flag == "--requirepass"){
            if(flag.flagValue.empty()){
                reportErrorMessage("Missing value for --requirepass", 1);
            }
            requirepass = flag.flagValue;
        }
        else{
            reportMessageNonError(("Unknown flag ignored: " + flag.flag).c_str());
        }
    }
}

void printASCII(){
    std::vector<std::string> ASCII_ART = {
        " ______     ______     _____     __     __  __ ",
        "/\\  == \\   /\\  ___\\   /\\  __-.  /\\ \\   /\\_\\_\\_\\  ",
        "\\ \\  __<   \\ \\  __\\   \\ \\ \\/\\ \\ \\ \\ \\  \\/_/\\_\\/_",
        " \\ \\_\\ \\_\\  \\ \\_____\\  \\ \\____-  \\ \\_\\   /\\_\\/\\_\\",
        "  \\/_/ /_/   \\/_____/   \\/____/   \\/_/   \\/_/\\/_/ "
    };

    for (const auto& line : ASCII_ART) {
        std::cout << line << "\n";
    }
}