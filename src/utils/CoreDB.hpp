#ifndef COREDB_H
#define COREDB_H

#include <cstdint>
#include <vector>
#include <string>

// "../presistence/redix.aof" "../presistence/redix.aof.tmp"
struct Conn;

extern std::string requirepass;
extern std::string AOF_PATH;
extern std::string AOF_TEMP;

typedef struct Node {
    std::string key;
    std::string value;
    struct Node *next;
    uint64_t expire_at = 0;
} Node;

typedef struct AVLNode {
    Node *data;
    struct AVLNode *left;
    struct AVLNode *right;
    int height = 0;
} AVLNode;

typedef struct HashTable {
    size_t CAP;
    size_t hold = 0;
    std::vector<Node*> table;
    HashTable(size_t cap) : CAP(cap), table(cap, nullptr) {};
} Hashtable;

typedef struct db {
    size_t latestCAP;
    std::vector<HashTable> htx;
    AVLNode *ttl_tree = nullptr;
    bool isMigrating = false;
    int LastMigrateIndex = -1;
    db(size_t f_cap) : latestCAP(f_cap), htx(1, latestCAP){};
} db;

Node *CreateNode(std::string key, std::string val);
Node *pushNode(Node **chain, std::string key, std::string val);
Node *relinkNode(Node **newChain, Node *x);
Node *Search_hash(const std::string &key);

AVLNode *CreateAVLNode(Node *data);
AVLNode *rotate_r(AVLNode *x);
AVLNode *rotate_l(AVLNode *x);
AVLNode *successor(AVLNode *r);
AVLNode *insertNode(AVLNode *root, Node *k);
AVLNode *removeNode(AVLNode *root, Node *k);
AVLNode *searchNode(AVLNode *root, Node *x);
AVLNode *get_min_node(AVLNode *root);

size_t hash_func(const std::string &key, size_t CAP);
int Insert(const std::string &key, const std::string &val);
int max(int a, int b);
int height(AVLNode *x);
int balance(AVLNode *x);

bool Delete(const std::string &key);

void resize_hash_init();
void rehash_one();
void main_thread_process_ttl(int limit);
void init_aof();
void shutdown_aof();
void append_cmd_aof(const std::vector<std::string> &cmd);
void aof_background_worker();

extern db database;
extern bool is_recovering;

//placeholder map for storing data in memory
//static std::unordered_map<std::string, std::string> db;
//literally ambil -> set nama arco -> ['set', 'nama', 'arco'] as Vector string
std::vector<std::string> cmd_parse(const std::string &req);
std::string build_resp_array(const std::vector<std::string>& args);
std::string cmd_exec(const std::vector<std::string> &parsed_cmd, Conn *conn = nullptr);
std::string rewrite_aof();

#endif