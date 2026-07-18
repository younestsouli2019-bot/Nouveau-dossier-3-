import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { fetchUsers, fetchPosts, createPost, updatePost, deletePost } from './api';
import { formatDate, truncateText, validateEmail } from './utils';
import { Button } from './components/Button';
import { Modal } from './components/Modal';
import { UserCard } from './components/UserCard';

// Types
interface User {
  id: string;
  name: string;
  email: string;
  avatar: string;
  role: 'admin' | 'user' | 'moderator';
  createdAt: string;
  updatedAt: string;
}

interface Post {
  id: string;
  title: string;
  content: string;
  authorId: string;
  tags: string[];
  publishedAt: string;
  viewCount: number;
  likeCount: number;
}

interface AppState {
  users: User[];
  posts: Post[];
  loading: boolean;
  error: string | null;
  selectedUser: User | null;
  selectedPost: Post | null;
  searchQuery: string;
  filterTag: string | null;
  sortBy: 'date' | 'views' | 'likes';
  page: number;
  pageSize: number;
  totalItems: number;
}

// Constants
const DEFAULT_PAGE_SIZE = 20;
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '/api/v2';
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
const DEBOUNCE_DELAY = 300;

/**
 * UserDashboard - Main dashboard component for user management
 * Handles user listing, search, filtering, and profile viewing
 */
export class UserDashboard {
  private state: AppState;
  private cache: Map<string, { data: unknown; timestamp: number }>;
  private abortController: AbortController | null;

  constructor(initialState?: Partial<AppState>) {
    this.state = {
      users: [],
      posts: [],
      loading: false,
      error: null,
      selectedUser: null,
      selectedPost: null,
      searchQuery: '',
      filterTag: null,
      sortBy: 'date',
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
      totalItems: 0,
      ...initialState,
    };
    this.cache = new Map();
    this.abortController = null;
  }

  // Fetch all users with caching and retry logic
  async fetchUsers(): Promise<User[]> {
    const cacheKey = 'users';
    const cached = this.getFromCache<User[]>(cacheKey);
    if (cached) return cached;

    this.setState({ loading: true, error: null });
    
    try {
      const users = await this.withRetry(() => fetchUsers());
      this.setState({ users, loading: false });
      this.addToCache(cacheKey, users);
      return users;
    } catch (error) {
      this.setState({ error: (error as Error).message, loading: false });
      throw error;
    }
  }

  // Fetch posts with filtering and pagination
  async fetchPosts(options?: { page?: number; tag?: string }): Promise<Post[]> {
    const { page = 1, tag } = options || {};
    const cacheKey = `posts-${page}-${tag || 'all'}`;
    const cached = this.getFromCache<Post[]>(cacheKey);
    if (cached) return cached;

    try {
      const posts = await this.withRetry(() => fetchPosts({ page, tag }));
      this.addToCache(cacheKey, posts);
      return posts;
    } catch (error) {
      this.setState({ error: (error as Error).message });
      throw error;
    }
  }

  // Create a new post
  async createPost(post: Omit<Post, 'id' | 'publishedAt' | 'viewCount' | 'likeCount'>): Promise<Post> {
    try {
      const newPost = await createPost(post);
      this.setState(prev => ({
        posts: [newPost, ...prev.posts],
        totalItems: prev.totalItems + 1,
      }));
      this.invalidateCache('posts');
      return newPost;
    } catch (error) {
      this.setState({ error: (error as Error).message });
      throw error;
    }
  }

  private setState(update: Partial<AppState> | ((prev: AppState) => AppState)): void {
    if (typeof update === 'function') {
      this.state = update(this.state);
    } else {
      this.state = { ...this.state, ...update };
    }
  }

  private getFromCache<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > CACHE_DURATION) {
      this.cache.delete(key);
      return null;
    }
    return entry.data as T;
  }

  private addToCache(key: string, data: unknown): void {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  private invalidateCache(prefix: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  private async withRetry<T>(fn: () => Promise<T>, retries = MAX_RETRIES): Promise<T> {
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        if (attempt === retries - 1) throw error;
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * (attempt + 1)));
      }
    }
    throw new Error('Max retries exceeded');
  }
}

/**
 * Utility function to filter and sort posts
 */
export function filterAndSortPosts(
  posts: Post[],
  options: {
    searchQuery?: string;
    tag?: string | null;
    sortBy?: 'date' | 'views' | 'likes';
  }
): Post[] {
  let filtered = [...posts];

  if (options.searchQuery) {
    const query = options.searchQuery.toLowerCase();
    filtered = filtered.filter(
      post =>
        post.title.toLowerCase().includes(query) ||
        post.content.toLowerCase().includes(query)
    );
  }

  if (options.tag) {
    filtered = filtered.filter(post => post.tags.includes(options.tag!));
  }

  switch (options.sortBy) {
    case 'views':
      filtered.sort((a, b) => b.viewCount - a.viewCount);
      break;
    case 'likes':
      filtered.sort((a, b) => b.likeCount - a.likeCount);
      break;
    case 'date':
    default:
      filtered.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
      break;
  }

  return filtered;
}

/**
 * Custom hook for debounced search
 */
export function useDebouncedSearch(delay = DEBOUNCE_DELAY) {
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedTerm, setDebouncedTerm] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedTerm(searchTerm), delay);
    return () => clearTimeout(timer);
  }, [searchTerm, delay]);

  return { searchTerm, debouncedTerm, setSearchTerm };
}

/**
 * Format a number with commas for display
 */
export function formatNumber(num: number): string {
  return new Intl.NumberFormat('en-US').format(num);
}

/**
 * Calculate token savings percentage
 */
export function calculateSavings(original: number, optimized: number): number {
  if (original === 0) return 0;
  return Math.round(((original - optimized) / original) * 100);
}