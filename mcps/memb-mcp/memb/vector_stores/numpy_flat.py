import os
import json
import sqlite3
import numpy as np
from typing import List, Dict, Any, Optional
from memb.vector_stores.base import VectorStoreBase


class SearchResult:
    def __init__(self, id_val, score_val, payload_val):
        self.id = id_val
        self.score = score_val
        self.payload = payload_val


class GetResult:
    def __init__(self, id_val, vector_val, payload_val):
        self.id = id_val
        self.vector = vector_val
        self.payload = payload_val


class ListResult:
    def __init__(self, id_val, vector_val, payload_val):
        self.id = id_val
        self.vector = vector_val
        self.payload = payload_val


class NumPyFlat(VectorStoreBase):
    def __init__(
        self,
        collection_name: str = "memb",
        path: Optional[str] = None,
        distance_strategy: str = "cosine"
    ):
        self.collection_name = collection_name
        self.db_path = path if path else os.path.expanduser("~/.MemBDB/memb.db")
        
        # Ensure parent folder exists
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        
        # Initialize Database table & FTS index
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        """Returns a hardened SQLite connection with WAL mode and 30s busy timeout."""
        conn = sqlite3.connect(self.db_path, timeout=30.0)
        conn.execute("PRAGMA journal_mode = WAL;")
        conn.execute("PRAGMA synchronous = NORMAL;")
        conn.execute("PRAGMA busy_timeout = 30000;")
        return conn

    def _init_db(self):
        with self._get_connection() as conn:
            cursor = conn.cursor()
            # 1. Base vector and payload table
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS memb_vectors (
                    id TEXT PRIMARY KEY,
                    collection TEXT,
                    vector BLOB,
                    payload TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_memb_col ON memb_vectors(collection);")
            
            # 2. Full-Text Search (FTS5) virtual table for BM25 hybrid ranking
            cursor.execute(
                """
                CREATE VIRTUAL TABLE IF NOT EXISTS memb_fts USING fts5(
                    id UNINDEXED,
                    collection,
                    content,
                    tokenize = 'unicode61'
                );
                """
            )
            
            # 3. One-time FTS backfill if vectors exist but FTS is unpopulated
            cursor.execute("SELECT count(*) FROM memb_fts WHERE collection = ?", (self.collection_name,))
            fts_count = cursor.fetchone()[0]
            if fts_count == 0:
                cursor.execute("SELECT id, payload FROM memb_vectors WHERE collection = ?", (self.collection_name,))
                rows = cursor.fetchall()
                for r_id, p_str in rows:
                    try:
                        p = json.loads(p_str)
                        text = p.get("data") or p.get("memory") or ""
                        if text:
                            cursor.execute(
                                "INSERT INTO memb_fts (id, collection, content) VALUES (?, ?, ?)",
                                (r_id, self.collection_name, text)
                            )
                    except Exception:
                        pass
            conn.commit()

    def create_col(self, name, vector_size, distance):
        pass

    def insert(self, vectors, payloads=None, ids=None):
        if not ids:
            raise ValueError("IDs must be provided for insertion in NumPyFlat.")
            
        with self._get_connection() as conn:
            cursor = conn.cursor()
            for idx, vec in enumerate(vectors):
                id_val = ids[idx]
                payload = payloads[idx] if payloads else {}
                
                payload_str = json.dumps(payload)
                vec_blob = np.array(vec, dtype=np.float32).tobytes()
                
                # 1. Insert/Replace vector table
                cursor.execute(
                    """
                    INSERT OR REPLACE INTO memb_vectors (id, collection, vector, payload)
                    VALUES (?, ?, ?, ?)
                    """,
                    (id_val, self.collection_name, vec_blob, payload_str)
                )
                
                # 2. Synchronize FTS5 index
                text_content = payload.get("data") or payload.get("memory") or ""
                cursor.execute("DELETE FROM memb_fts WHERE id = ? AND collection = ?", (id_val, self.collection_name))
                if text_content:
                    cursor.execute(
                        "INSERT INTO memb_fts (id, collection, content) VALUES (?, ?, ?)",
                        (id_val, self.collection_name, text_content)
                    )
            conn.commit()

    def search(self, query, vectors, top_k=5, filters=None):
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT id, vector, payload FROM memb_vectors WHERE collection = ?",
                (self.collection_name,)
            )
            rows = cursor.fetchall()
        
        if not rows:
            return []
            
        query_vector = np.array(vectors, dtype=np.float32)
        norm_q = np.linalg.norm(query_vector)
        
        results = []
        for row_id, vec_bytes, payload_str in rows:
            payload = json.loads(payload_str)
            
            # Apply metadata filters
            if filters:
                match = True
                for k, v in filters.items():
                    if payload.get(k) != v:
                        match = False
                        break
                if not match:
                    continue
                    
            db_vector = np.frombuffer(vec_bytes, dtype=np.float32)
            norm_db = np.linalg.norm(db_vector)
            
            # Cosine Similarity: dot(A, B) / (norm(A) * norm(B))
            denom = norm_q * norm_db
            score = float(np.dot(query_vector, db_vector) / denom) if denom > 0 else 0.0
            score = float(max(0.0, min(1.0, score)))
            
            results.append(SearchResult(row_id, score, payload))
            
        results.sort(key=lambda x: x.score, reverse=True)
        return results[:top_k]

    def keyword_search(self, query: str, top_k: int = 5, filters: Optional[Dict[str, Any]] = None):
        """Native FTS5 BM25 keyword search for exact code and token matching."""
        if not query or not query.strip():
            return []
            
        clean_words = [w.strip() for w in query.replace('"', ' ').replace("'", ' ').replace('*', ' ').split() if w.strip()]
        if not clean_words:
            return []
            
        clean_query = " OR ".join(f'"{w}"' for w in clean_words)
        
        with self._get_connection() as conn:
            cursor = conn.cursor()
            try:
                cursor.execute(
                    """
                    SELECT f.id, v.payload, bm25(memb_fts) as raw_score
                    FROM memb_fts f
                    JOIN memb_vectors v ON f.id = v.id
                    WHERE memb_fts MATCH ? AND f.collection = ?
                    ORDER BY raw_score ASC
                    LIMIT ?
                    """,
                    (clean_query, self.collection_name, max(top_k * 4, 20))
                )
                rows = cursor.fetchall()
            except Exception:
                return []
        
        results = []
        for r_id, p_str, raw_bm25 in rows:
            payload = json.loads(p_str)
            if filters:
                match = True
                for k, v in filters.items():
                    if payload.get(k) != v:
                        match = False
                        break
                if not match:
                    continue
                    
            # Normalize SQLite BM25 score (negative numbers where more negative is stronger) to positive [0, 1]
            abs_score = abs(raw_bm25)
            norm_score = float(1.0 / (1.0 + abs_score))
            results.append(SearchResult(r_id, norm_score, payload))
            
        results.sort(key=lambda x: x.score, reverse=True)
        return results[:top_k]

    def delete(self, vector_id):
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM memb_vectors WHERE id = ?", (vector_id,))
            cursor.execute("DELETE FROM memb_fts WHERE id = ?", (vector_id,))
            conn.commit()

    def update(self, vector_id, vector=None, payload=None):
        with self._get_connection() as conn:
            cursor = conn.cursor()
            
            if vector is not None:
                vec_blob = np.array(vector, dtype=np.float32).tobytes()
                cursor.execute(
                    "UPDATE memb_vectors SET vector = ? WHERE id = ?",
                    (vec_blob, vector_id)
                )
                
            if payload is not None:
                cursor.execute("SELECT payload FROM memb_vectors WHERE id = ?", (vector_id,))
                row = cursor.fetchone()
                if row:
                    existing_payload = json.loads(row[0])
                    existing_payload.update(payload)
                    cursor.execute(
                        "UPDATE memb_vectors SET payload = ? WHERE id = ?",
                        (json.dumps(existing_payload), vector_id)
                    )
                    
                    text_content = existing_payload.get("data") or existing_payload.get("memory") or ""
                    cursor.execute("DELETE FROM memb_fts WHERE id = ? AND collection = ?", (vector_id, self.collection_name))
                    if text_content:
                        cursor.execute(
                            "INSERT INTO memb_fts (id, collection, content) VALUES (?, ?, ?)",
                            (vector_id, self.collection_name, text_content)
                        )
            conn.commit()

    def get(self, vector_id):
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT id, vector, payload FROM memb_vectors WHERE id = ?",
                (vector_id,)
            )
            row = cursor.fetchone()
            
        if not row:
            return None
            
        db_vector = np.frombuffer(row[1], dtype=np.float32).tolist()
        payload = json.loads(row[2])
        return GetResult(row[0], db_vector, payload)

    def list_cols(self):
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT DISTINCT collection FROM memb_vectors")
            cols = [r[0] for r in cursor.fetchall()]
        return cols

    def delete_col(self):
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM memb_vectors WHERE collection = ?", (self.collection_name,))
            cursor.execute("DELETE FROM memb_fts WHERE collection = ?", (self.collection_name,))
            conn.commit()

    def col_info(self):
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) FROM memb_vectors WHERE collection = ?", (self.collection_name,))
            count = cursor.fetchone()[0]
        return {"count": count}

    def list(self, filters=None, top_k=None):
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT id, vector, payload FROM memb_vectors WHERE collection = ?",
                (self.collection_name,)
            )
            rows = cursor.fetchall()
            
        results = []
        for row_id, vec_bytes, payload_str in rows:
            payload = json.loads(payload_str)
            
            if filters:
                match = True
                for k, v in filters.items():
                    if payload.get(k) != v:
                        match = False
                        break
                if not match:
                    continue
                    
            db_vector = np.frombuffer(vec_bytes, dtype=np.float32).tolist()
            results.append(ListResult(row_id, db_vector, payload))
            
        if top_k:
            results = results[:top_k]
        return results

    def reset(self):
        self.delete_col()
