import React, { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  X,
  Filter,
  Inbox,
  ChevronRight,
  Sparkles,
  Layers,
  Clock,
  ArrowUpDown,
  Tag,
} from "lucide-react";

export interface ListItem {
  id: string;
  title: string;
  category: "Design" | "Engineering" | "Marketing" | "Product";
  updatedAt: string;
  status: "Active" | "Draft" | "Archived";
  author: string;
}

const mockItems: ListItem[] = [
  {
    id: "1",
    title: "Toss UI Design Tokens v4",
    category: "Design",
    updatedAt: "2 hours ago",
    status: "Active",
    author: "Alex Rivera",
  },
  {
    id: "2",
    title: "Framer Motion Spring Presets",
    category: "Engineering",
    updatedAt: "1 day ago",
    status: "Active",
    author: "Sarah Chen",
  },
  {
    id: "3",
    title: "Q3 Product Roadmap Pitch",
    category: "Product",
    updatedAt: "3 days ago",
    status: "Draft",
    author: "Jordan Lee",
  },
  {
    id: "4",
    title: "StyleSeed Brand Guidelines",
    category: "Marketing",
    updatedAt: "5 days ago",
    status: "Archived",
    author: "Taylor Kim",
  },
  {
    id: "5",
    title: "WCAG 2.1 Accessibility Audit Checklist",
    category: "Design",
    updatedAt: "1 week ago",
    status: "Active",
    author: "Alex Rivera",
  },
];

const springPhysics = {
  type: "spring",
  stiffness: 380,
  damping: 26,
};

export default function DataListPattern() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("All");
  const [isLoading, setIsLoading] = useState(false);

  const categories = ["All", "Design", "Engineering", "Marketing", "Product"];

  // Filter items dynamically
  const filteredItems = useMemo(() => {
    return mockItems.filter((item) => {
      const matchesSearch =
        item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.author.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory =
        selectedCategory === "All" || item.category === selectedCategory;
      return matchesSearch && matchesCategory;
    });
  }, [searchQuery, selectedCategory]);

  const handleSimulateReload = () => {
    setIsLoading(true);
    setTimeout(() => setIsLoading(false), 1200);
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm">
      {/* Pattern Header */}
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Layers className="text-indigo-600 dark:text-indigo-400" size={22} />
            Data List Pattern
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Filterable content list with live search, animated layout changes, and WCAG AA focus.
          </p>
        </div>

        <button
          onClick={handleSimulateReload}
          className="self-start sm:self-auto text-xs px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          Simulate Loading
        </button>
      </header>

      {/* Filter and Search Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
        {/* Search Input */}
        <div className="relative w-full sm:w-72">
          <Search
            size={16}
            className="absolute left-3 top-3 text-slate-400"
            aria-hidden="true"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search items or authors..."
            aria-label="Search items"
            className="w-full pl-9 pr-8 py-2 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              aria-label="Clear search query"
            >
              <X size={16} />
            </button>
          )}
        </div>

        {/* Category Filter Chips */}
        <div className="flex items-center space-x-1.5 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
          {categories.map((cat) => {
            const isSelected = selectedCategory === cat;
            return (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                  isSelected
                    ? "bg-indigo-600 text-white shadow-xs"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
                }`}
              >
                {cat}
              </button>
            );
          })}
        </div>
      </div>

      {/* List Content */}
      <div className="space-y-3 min-h-[260px]">
        {/* Loading State */}
        {isLoading ? (
          <div className="space-y-3" aria-busy="true">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="p-4 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2 animate-pulse"
              >
                <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-1/3" />
                <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-1/4" />
              </div>
            ))}
          </div>
        ) : filteredItems.length === 0 ? (
          /* Empty State */
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center justify-center py-12 text-center space-y-3 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl"
          >
            <div className="p-3 bg-slate-100 dark:bg-slate-800 text-slate-500 rounded-full">
              <Inbox size={28} />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                No matching results found
              </h3>
              <p className="text-xs text-slate-500 max-w-xs">
                Try adjusting your search keywords or switching category filters.
              </p>
            </div>
            {(searchQuery || selectedCategory !== "All") && (
              <button
                onClick={() => {
                  setSearchQuery("");
                  setSelectedCategory("All");
                }}
                className="text-xs text-indigo-600 dark:text-indigo-400 font-semibold hover:underline"
              >
                Reset Filters
              </button>
            )}
          </motion.div>
        ) : (
          /* Populated List Items with Spring Motion */
          <AnimatePresence>
            {filteredItems.map((item) => (
              <motion.div
                key={item.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98 }}
                whileHover={{ scale: 1.01, x: 2 }}
                transition={springPhysics}
                className="p-4 bg-slate-50 dark:bg-slate-800/50 hover:bg-white dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl transition-all shadow-xs flex items-center justify-between group cursor-pointer"
              >
                <div className="space-y-1">
                  <div className="flex items-center space-x-2">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                      {item.title}
                    </h3>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${
                        item.status === "Active"
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                          : item.status === "Draft"
                          ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                          : "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300"
                      }`}
                    >
                      {item.status}
                    </span>
                  </div>

                  <div className="flex items-center space-x-4 text-xs text-slate-500">
                    <span className="flex items-center gap-1">
                      <Tag size={12} />
                      {item.category}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock size={12} />
                      {item.updatedAt}
                    </span>
                    <span>By {item.author}</span>
                  </div>
                </div>

                <ChevronRight
                  size={18}
                  className="text-slate-400 group-hover:text-indigo-600 group-hover:translate-x-0.5 transition-all"
                />
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>

      {/* Footer Meta Summary */}
      <footer className="flex items-center justify-between border-t border-slate-100 dark:border-slate-800 pt-4 text-xs text-slate-500">
        <span>
          Showing <strong>{filteredItems.length}</strong> of <strong>{mockItems.length}</strong> items
        </span>
        <span>Page 1 of 1</span>
      </footer>
    </div>
  );
}
