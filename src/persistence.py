"""
Compatibility shim for persistence.py

This file re-exports all functions from the new modular structure.
Eventually, imports should be updated to use the specific modules directly.

New modules:
- db.py: Database core (connection, init, schema)
- cache.py: Caching layer (in-memory, disk, quality, highlights)
- embeddings.py: Vector embeddings and semantic search
- annotations.py: Annotation system (feedback, categories, prompts)
- users.py: User management (auth, sessions, teams, social features)
- utils_persistence.py: Utility functions (slugify, proxy rewriter, reference cache)
"""

# Re-export from db.py
from db import (
    DIR, VAULT_DIR, SAVED_CONTENT_DIR, DB_PATH, SESSION_TTL,
    _get_db, init_db, get_vault_project_dir, log_usage
)

# Re-export from cache.py
from cache import (
    CACHE_TTL, FEED_CACHE_DIR, _cache,
    _content_path, read_saved_content, write_saved_content,
    _feed_cache_path, _disk_cache_get, _disk_cache_set, cached_fetch,
    _title_hash, quality_cache_get, quality_cache_set,
    smart_highlights_get, smart_highlights_set
)

# Re-export from embeddings.py
from embeddings import (
    _embedding_hash, _pack_embedding, _unpack_embedding, _cosine_similarity,
    embed_text_ollama, store_embedding, search_embeddings, pairwise_similarities,
    store_chat_memory, search_chat_memories, list_chat_memories,
    delete_chat_memory, get_memory_stats
)

# Re-export from annotations.py
from annotations import (
    BLOCKED_TITLES_FILE, PROMPT_FILE, ANNOTATION_PROMPT_FILE,
    DEFAULT_VERDICT_PROMPT, DEFAULT_SCORING_PROMPT,
    _DEFAULT_PROMPT_HASH, _DEFAULT_SCORING_HASH,
    read_blocked_titles, write_blocked_titles,
    read_prompt, write_prompt,
    read_annotation_prompt, write_annotation_prompt, annotation_prompt_mtime,
    store_annotation_feedback, list_annotation_feedback,
    update_annotation_feedback_rating, delete_annotation_feedback,
    get_annotation_feedback_stats,
    list_annotation_categories, add_annotation_category, delete_annotation_category,
    classify_title
)

# Re-export from users.py
from users import (
    upsert_google_user, get_user_info, set_username, delete_user,
    create_session, get_session_user, delete_session,
    get_all_user_data, get_user_data, set_user_data, set_user_data_bulk,
    create_team, get_user_teams, get_team, delete_team, rename_team,
    get_user_public_teams, invite_to_team, get_pending_invites,
    respond_to_invite, remove_team_member,
    get_user_calendar, create_calendar_event, update_calendar_event, delete_calendar_event,
    db_get_comments, db_create_comment, db_delete_comment,
    touch_last_seen, update_user_status, get_user_feed_sources,
    get_public_user_info, get_user_public_stats, get_user_recent_comments,
    create_repost, get_user_reposts, delete_repost,
    set_blog_vote, get_blog_votes,
    ACHIEVEMENTS, get_user_achievements, grant_achievement, has_achievement,
    get_user_shared_experiments, search_users, list_users,
    send_direct_message, get_direct_messages, mark_message_read,
    delete_direct_message, get_unread_message_count, get_user_by_username,
    toggle_reaction, get_message_reactions, get_messages_reactions_bulk,
    send_team_message, get_team_messages, update_team_message, delete_team_message,
    mark_team_chat_read, get_unread_team_chats, get_unread_team_chat_count,
    get_team_todos, create_team_todo, update_team_todo, delete_team_todo, get_my_assigned_todos,
    update_user_picture, update_user_profile_bg, get_user_accent_color,
    set_profile_private, are_teammates, set_team_private, set_team_parent,
    get_team_children, get_team_ancestors,
    get_usage_history
)

# Re-export from utils_persistence.py
from utils_persistence import (
    slugify, unique_vault_slug,
    rewrite_proxy_html,
    get_cached_references, set_cached_references,
    AUTHOR_CACHE_STATS_TTL, get_cached_author, set_cached_author
)
