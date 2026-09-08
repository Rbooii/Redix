#include "CoreDB.hpp"
#include "CoreDebug.hpp"
#include <sstream>
#include <stdlib.h>
#include <cstdio>
#include <algorithm>
#include <chrono>
#include <fstream>
#include <thread>
#include <mutex>
#include <condition_variable>
#include <queue>

bool aof_reopen_requested = false;
std::queue<std::string> aof_queue;
std::mutex aof_mutex;
std::condition_variable aof_cv;
bool aof_worker_running = true;
std::thread aof_thread;

db database(4);
bool is_recovering = false;
std::ofstream aof_file;

void aof_background_worker()
{
  std::ofstream worker_file;
  worker_file.open(AOF_PATH, std::ios::out | std::ios::app);

  if (!worker_file.is_open())
  {
    reportErrorMessage("Background AOF worker failed to open file!", 0);
    return;
  }

  while (1)
  {
    std::vector<std::string> local_batch;
    bool do_reopen = false;
    {
      std::unique_lock<std::mutex> lock(aof_mutex);
      aof_cv.wait(lock, []
                  { return !aof_queue.empty() || !aof_worker_running || aof_reopen_requested; });

    
      if (aof_reopen_requested)
      {
        do_reopen = true;
        aof_reopen_requested = false;
      }

      if (!aof_worker_running && aof_queue.empty())
      {
        break;
      }
      while (!aof_queue.empty())
      {
        local_batch.push_back(aof_queue.front());
        aof_queue.pop();
      }
    }
    if (do_reopen)
    {
      worker_file.close();
      worker_file.open(AOF_PATH, std::ios::out | std::ios::app);
      if (!worker_file.is_open())
      {
        reportErrorMessage("AOF worker failed to reopen file after rewrite! Aborting.", 1);
        return;
      }
    }
    for (const auto &resp_str : local_batch)
    {
      worker_file << resp_str;
    }
    worker_file.flush();
  }

  worker_file.close();
}

void init_aof()
{
  aof_thread = std::thread(aof_background_worker);
}

// gracefull shutdown
void shutdown_aof()
{
  {
    std::lock_guard<std::mutex> lock(aof_mutex);
    aof_worker_running = false;
  }

  aof_cv.notify_one();

  if (aof_thread.joinable())
  {
    aof_thread.join();
  }
}

void append_cmd_aof(const std::vector<std::string> &cmd)
{
  std::string resp = "*" + std::to_string(cmd.size()) + "\r\n";
  for (const auto &token : cmd)
  {
    resp += "$" + std::to_string(token.length()) + "\r\n" + token + "\r\n";
  }

  {
    // Masukin data ke antrean dengan aman (Thread-safe)
    std::lock_guard<std::mutex> lock(aof_mutex);
    aof_queue.push(resp);
  }

  // Bangunkan background worker yang lagi tidur
  aof_cv.notify_one();
}

static uint64_t get_time_ms()
{
  auto now_tmp = std::chrono::system_clock::now();
  return (uint64_t)std::chrono::duration_cast<std::chrono::milliseconds>(now_tmp.time_since_epoch()).count();
}

Node *CreateNode(std::string key, std::string val)
{
  Node *x = new Node;
  x->next = NULL;
  x->value = val;
  x->key = key;
  return x;
};

int max(int a, int b)
{
  return (a > b) ? a : b;
}

int height(AVLNode *x)
{
  if (!x)
    return 0;
  return x->height;
}

int balance(AVLNode *x)
{
  return height(x->left) - height(x->right);
}

AVLNode *CreateAVLNode(Node *data)
{
  AVLNode *x = new AVLNode;
  x->left = x->right = nullptr;
  x->data = data;
  return x;
}

AVLNode *get_min_node(AVLNode *root)
{
  if (!root)
    return nullptr;
  AVLNode *curr = root;
  while (curr->left)
  {
    curr = curr->left;
  }
  return curr;
}

void main_thread_process_ttl(int limit)
{
  while (limit > 0 && database.ttl_tree != nullptr)
  {
    AVLNode *min_node = get_min_node(database.ttl_tree);
    if (!min_node || min_node->data->expire_at > get_time_ms())
    {
      break;
    }
    std::string expired_key = min_node->data->key;
    Delete(expired_key);
    limit--;
  }
}

AVLNode *rotate_r(AVLNode *x)
{
  AVLNode *y = x->left;
  AVLNode *t = y->right;
  y->right = x;
  x->left = t;
  x->height = 1 + max(height(x->left), height(x->right));
  y->height = 1 + max(height(y->left), height(y->right));
  return y;
}

AVLNode *rotate_l(AVLNode *x)
{
  AVLNode *y = x->right;
  AVLNode *t = y->left;
  y->left = x;
  x->right = t;
  x->height = 1 + max(height(x->left), height(x->right));
  y->height = 1 + max(height(y->left), height(y->right));
  return y;
}

AVLNode *successor(AVLNode *r)
{
  AVLNode *x = r->right;
  while (x->left)
  {
    x = x->left;
  }
  return x;
}

AVLNode *insertNode(AVLNode *root, Node *k)
{
  if (!root)
    return CreateAVLNode(k);
  else if (k->expire_at < root->data->expire_at)
    root->left = insertNode(root->left, k);
  else if (k->expire_at > root->data->expire_at)
    root->right = insertNode(root->right, k);
  else if (k->key > root->data->key)
    root->right = insertNode(root->right, k);
  else if (k->key < root->data->key)
    root->left = insertNode(root->left, k);
  else
    return root;

  root->height = 1 + max(height(root->left), height(root->right));
  // balance
  int bf = balance(root);
  if (bf > 1 && k->expire_at < root->left->data->expire_at)
    return rotate_r(root);
  if (bf < -1 && k->expire_at > root->right->data->expire_at)
    return rotate_l(root);
  if (bf > 1 && k->expire_at > root->left->data->expire_at)
  {
    root->left = rotate_l(root->left);
    return rotate_r(root);
  }
  if (bf < -1 && k->expire_at < root->right->data->expire_at)
  {
    root->right = rotate_r(root->right);
    return rotate_l(root);
  }
  return root;
}

AVLNode *removeNode(AVLNode *root, Node *k)
{
  if (!root)
    return root;
  else if (k->expire_at < root->data->expire_at)
    root->left = removeNode(root->left, k);
  else if (k->expire_at > root->data->expire_at)
    root->right = removeNode(root->right, k);
  else
  {
    if (!root->left || !root->right)
    {
      AVLNode *t = (root->left) ? root->left : root->right;
      if (!t)
      {
        t = root;
        root = NULL;
      }
      else
      {
        *root = *t;
      }
      delete t;
    }
    else
    {
      AVLNode *t = successor(root);
      root->data->expire_at = t->data->expire_at;
      root->right = removeNode(root->right, t->data);
    }
  }
  if (!root)
    return root;
  root->height = 1 + max(height(root->left), height(root->right));
  int bf = balance(root);
  if (bf > 1 && balance(root->left) >= 0)
    return rotate_r(root);
  if (bf > 1 && balance(root->left) < 0)
  {
    root->left = rotate_l(root->left);
    return rotate_r(root);
  }
  if (bf < -1 && balance(root->right) <= 0)
    return rotate_l(root);
  if (bf < -1 && balance(root->right) > 0)
  {
    root->right = rotate_r(root->right);
    return rotate_l(root);
  }
  return root;
}

AVLNode *searchNode(AVLNode *root, Node *x)
{
  if (!root)
    return NULL;
  else if (x < root->data)
    return searchNode(root->left, x);
  else if (x > root->data)
    return searchNode(root->right, x);
  else
    return root;
}

static bool Overload_check(HashTable *current)
{
  return current->hold >= current->CAP;
}

void resize_hash_init()
{
  if (Overload_check(&database.htx[0]) && database.isMigrating == false)
  {
    printf("MIGRATE!\n");
    // kalau overload mulai hash migrate
    database.isMigrating = true;
    size_t newCap = database.latestCAP * 2;
    database.latestCAP = newCap;
    database.LastMigrateIndex = 0; // init
    HashTable ht2(newCap);
    database.htx.push_back(ht2);
  }
  return;
}
// relink harus return head ke hash table lama
Node *relinkNode(Node **newChain, Node *x)
{
  // selalu head
  Node *ReturnNode = x->next;
  x->next = (*newChain);
  (*newChain) = x;
  return ReturnNode;
}

void rehash_one()
{
  Node *curr = database.htx[0].table[database.LastMigrateIndex];
  database.htx[0].table[database.LastMigrateIndex] = nullptr;
  while (curr != nullptr)
  {
    size_t new_hash_key = hash_func(curr->key, database.latestCAP);
    curr = relinkNode(&(database.htx[1].table[new_hash_key]), curr);
  }
  database.LastMigrateIndex++;
  if (database.LastMigrateIndex >= database.htx[0].CAP)
  {
    // migrasi selesai
    database.htx.erase(database.htx.begin());
    database.isMigrating = false;
    database.LastMigrateIndex = -1;
  }
}

// change into push -> Head
Node *pushNode(Node **chain, std::string key, std::string val)
{
  Node *newNode = CreateNode(key, val);
  if (!(*chain))
  {
    return newNode;
  }
  newNode->next = (*chain);
  return newNode;
};

size_t hash_func(const std::string &key, size_t CAP)
{
  return std::hash<std::string>{}(key) % CAP;
};

Node *Search_hash(const std::string &key)
{
  if (database.isMigrating)
    rehash_one();
  int check = 0; // 0 -> old ht, 1-> new ht
  while (check < ((database.isMigrating) ? 2 : 1))
  {
    HashTable &x = database.htx[check];
    size_t hash_key = hash_func(key, x.CAP);
    if (x.table[hash_key] != nullptr)
    {
      // oke ada item coba cek dulu chain nya ada gak yang kita cari
      Node *curr = x.table[hash_key];
      while (curr && curr->key != key)
      {
        curr = curr->next;
      }
      if (!curr && check == 0)
      {
        // coba pindah ke table sebelah
        check = 1;
        continue;
      }
      else if (!curr && check == 1)
      {
        break; // udah di table kedua dan gaada
      }
      else
      {
        return curr;
        break;
      }
    }
    else if (x.table[hash_key] == nullptr && check == 0)
    {
      // pindah ke table kedua coba
      check = 1;
      continue;
    }
    else
    {
      // udah di table kedua dan kosong
      break;
    }
  }
  return nullptr;
}

// 0 -> error
// 1 -> set
// 2 -> update
// 3 -> still
int Insert(const std::string &key, const std::string &val)
{
  if (database.isMigrating)
    rehash_one();
  // kalau migrating -> ada ht 2 langsung isi disana otherwise isi ht1
  size_t hash_key = hash_func(
      key,
      (database.isMigrating) ? database.htx[1].CAP : database.htx[0].CAP);

  Node *check = Search_hash(key); // Search_hash(key);
  if (check)
  {
    // misal udah ada nodenya
    if (check->value != val)
    {
      // misal key ada tapi value beda sama command, jadinya mau di update
      check->value = val;
      return 2;
    }
    else
    {
      return 3;
    }
  }
  else
  {
    int mode = database.isMigrating ? 1 : 0;
    database.htx[mode].table[hash_key] = pushNode(&database.htx[mode].table[hash_key], key, val);
    database.htx[mode].hold++;
    if (mode == 0)
    {
      resize_hash_init();
    }
    return 1;
  }
  return 0;
}

bool Delete(const std::string &key)
{
  if (database.isMigrating)
    rehash_one();
  int check = 0; // 0 -> old ht, 1-> new ht
  while (check < ((database.isMigrating) ? 2 : 1))
  {
    HashTable &x = database.htx[check];
    size_t hash_key = hash_func(key, x.CAP);
    if (x.table[hash_key] != nullptr)
    {
      // oke ada item coba cek dulu chain nya ada gak yang kita cari
      Node *curr = x.table[hash_key];
      Node *prev = nullptr;
      while (curr && curr->key != key)
      {
        prev = curr;
        curr = curr->next;
      }
      if (!curr && check == 0)
      {
        // coba pindah ke table sebelah
        check = 1;
        continue;
      }
      else if (!curr && check == 1)
      {
        return false; // udah di table kedua dan gaada
      }
      else
      {
        // delete
        if (prev == nullptr)
        {
          x.table[hash_key] = curr->next;
        }
        else
        {
          prev->next = curr->next;
        }
        database.ttl_tree = removeNode(database.ttl_tree, curr);
        delete curr;
        database.htx[check].hold--;
        return true;
      }
    }
    else if (x.table[hash_key] == nullptr && check == 0)
    {
      // pindah ke table kedua coba
      check = 1;
      continue;
    }
    else
    {
      // udah di table kedua dan kosong
      return false;
    }
  }
  return false;
}

// literally ambil -> set nama arco -> ['set', 'nama', 'arco'] as Vector string
std::vector<std::string> cmd_parse(const std::string &req)
{
  std::vector<std::string> tokens;
  std::stringstream ss(req);
  std::string word;
  while (ss >> word)
  {
    tokens.push_back(word);
  }
  return tokens;
}

std::string build_resp_array(const std::vector<std::string> &args)
{
  std::string resp = "*" + std::to_string(args.size()) + "\r\n";
  for (const auto &arg : args)
  {
    resp += "$" + std::to_string(arg.size()) + "\r\n" + arg + "\r\n";
  }
  return resp;
}

std::string rewrite_aof()
{
  std::lock_guard<std::mutex> lock(aof_mutex);
  std::ofstream tmp_file(AOF_TEMP, std::ios::out | std::ios::trunc);
  if (!tmp_file.is_open())
    return "-ERR unable to open temp file\r\n";

  for (int i = 0; i < (database.isMigrating ? 2 : 1); i++)
  {
    for (size_t j = 0; j < database.htx[i].CAP; j++)
    {
      Node *curr = database.htx[i].table[j];
      while (curr)
      {
        if (curr->expire_at == 0 || curr->expire_at > get_time_ms())
        {
          std::vector<std::string> set_cmd = {"SET", curr->key, curr->value};
          tmp_file << build_resp_array(set_cmd);
          if (curr->expire_at > 0)
          {
            uint64_t remain_ms = curr->expire_at - get_time_ms();
            uint64_t remain_sec = (remain_ms / 1000) + 1; // Pembulatan ke atas
            std::vector<std::string> exp_cmd = {"EXPIRE", curr->key, std::to_string(remain_sec)};
            tmp_file << build_resp_array(exp_cmd);
          }
        }
        curr = curr->next;
      }
    }
  }
  tmp_file.close();
  while (!aof_queue.empty())
  {
    aof_queue.pop();
  }
  std::rename(AOF_TEMP, AOF_PATH);
  aof_reopen_requested = true;
  aof_cv.notify_one();
  return "+OK\r\n";
}

std::string cmd_exec(const std::vector<std::string> &parsed_cmd)
{
  if (parsed_cmd.empty())
    return "-ERR empty command\r\n"; // RESP Error

  std::string db_operand = parsed_cmd[0];
  // Convert command ke lowercase case-insensitive (SET, set, Set bakal valid semua)
  std::transform(db_operand.begin(), db_operand.end(), db_operand.begin(), ::tolower);

  if (db_operand == "set" && (parsed_cmd.size() == 3 || parsed_cmd.size() == 5))
  {
    if (parsed_cmd[2] == "NIL" || parsed_cmd[2] == "ERR")
      return "-ERR reserved keyword\r\n";

    int q = Insert(parsed_cmd[1], parsed_cmd[2]);
    if (q == 1 || q == 2 || q == 3)
    {
      if ((q == 1 || q == 2) && !is_recovering)
        append_cmd_aof(parsed_cmd);
      return "+OK\r\n"; // RESP Simple String (sukses)
    }
    else
    {
      return "-ERR internal error\r\n"; // RESP Error
    }
  }
  else if (db_operand == "get" && parsed_cmd.size() == 2)
  {
    Node *q = Search_hash(parsed_cmd[1]);

    // TODO : check TTL kalau > expire remove
    if (q)
    {
      if (q->expire_at > 0 && q->expire_at <= get_time_ms())
      {
        bool del_q = Delete(q->key);
        if (del_q)
          return "$-1\r\n";
      }
      // RESP Bulk String: $<panjang>\r\n<teks>\r\n
      return "$" + std::to_string(q->value.size()) + "\r\n" + q->value + "\r\n";
    }
    else
    {
      // RESP Null Bulk String
      return "$-1\r\n";
    }
  }
  else if (db_operand == "del" && parsed_cmd.size() == 2)
  {
    bool del_query = Delete(parsed_cmd[1]);
    if (del_query)
    {
      // RESP Integer: :<angka>\r\n
      if (!is_recovering)
        append_cmd_aof(parsed_cmd);
      return ":1\r\n";
    }
    else
    {
      return ":0\r\n";
    }
  }
  else if (db_operand == "expire" && parsed_cmd.size() == 3)
  {
    uint64_t ttl_sec = std::stoull(parsed_cmd[2]);
    Node *actualNode = Search_hash(parsed_cmd[1]);
    if (!actualNode)
      return ":0\r\n";
    if (actualNode->expire_at > 0)
    {
      database.ttl_tree = removeNode(database.ttl_tree, actualNode);
    }
    actualNode->expire_at = get_time_ms() + (ttl_sec * 1000);
    database.ttl_tree = insertNode(database.ttl_tree, actualNode);
    if (!is_recovering)
      append_cmd_aof(parsed_cmd);
    return ":1\r\n";
  }
  else if (db_operand == "bgrewriteaof" && parsed_cmd.size() == 1)
  {
    return rewrite_aof();
  }
  else
  {
    return "-ERR unknown command '" + parsed_cmd[0] + "'\r\n";
  }
}
