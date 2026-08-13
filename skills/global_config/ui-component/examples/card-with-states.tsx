import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertCircle,
  Inbox,
  CheckCircle2,
  RefreshCw,
  ArrowRight,
  UserCheck,
  Building2,
  Mail,
  ShieldCheck,
} from "lucide-react";

export type CardState = "loading" | "empty" | "error" | "success";

export interface AccountData {
  name: string;
  email: string;
  company: string;
  status: "active" | "pending" | "verified";
  storageUsedGB: number;
}

export interface CardWithStatesProps {
  state?: CardState;
  data?: AccountData | null;
  errorMessage?: string;
  onRetry?: () => void;
  onCreateNew?: () => void;
  className?: string;
}

const springTransition = {
  type: "spring",
  stiffness: 350,
  damping: 25,
};

export const CardWithStates: React.FC<CardWithStatesProps> = ({
  state = "success",
  data,
  errorMessage = "Failed to load account details. Please check your network connection.",
  onRetry,
  onCreateNew,
  className = "",
}) => {
  return (
    <div
      className={`relative w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm min-h-[280px] flex flex-col justify-between transition-colors ${className}`}
      data-slot="card-with-states"
    >
      <AnimatePresence mode="wait">
        {/* State 1: Loading (Skeleton) */}
        {state === "loading" && (
          <motion.div
            key="loading"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={springTransition}
            aria-busy="true"
            aria-live="polite"
            className="space-y-6 w-full my-auto"
          >
            <div className="flex items-center space-x-4">
              <div className="h-12 w-12 rounded-full bg-slate-200 dark:bg-slate-800 animate-pulse shrink-0" />
              <div className="space-y-2 flex-1">
                <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded animate-pulse w-3/4" />
                <div className="h-3 bg-slate-200 dark:bg-slate-800 rounded animate-pulse w-1/2" />
              </div>
            </div>

            <div className="space-y-3 pt-2">
              <div className="h-3 bg-slate-200 dark:bg-slate-800 rounded animate-pulse w-full" />
              <div className="h-3 bg-slate-200 dark:bg-slate-800 rounded animate-pulse w-5/6" />
              <div className="h-3 bg-slate-200 dark:bg-slate-800 rounded animate-pulse w-4/6" />
            </div>

            <div className="h-10 bg-slate-200 dark:bg-slate-800 rounded-lg animate-pulse w-full" />
          </motion.div>
        )}

        {/* State 2: Error */}
        {state === "error" && (
          <motion.div
            key="error"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={springTransition}
            role="alert"
            aria-live="assertive"
            className="flex flex-col items-center justify-center text-center space-y-4 my-auto py-2"
          >
            <div className="p-3 bg-red-100 dark:bg-red-950/50 text-red-600 dark:text-red-400 rounded-full">
              <AlertCircle size={28} aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Unable to Load Data
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 max-w-xs">
                {errorMessage}
              </p>
            </div>

            {onRetry && (
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={onRetry}
                className="inline-flex items-center space-x-2 px-4 py-2 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white text-xs font-semibold rounded-lg shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 transition-colors"
              >
                <RefreshCw size={14} className="shrink-0" />
                <span>Try Again</span>
              </motion.button>
            )}
          </motion.div>
        )}

        {/* State 3: Empty */}
        {state === "empty" && (
          <motion.div
            key="empty"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={springTransition}
            aria-live="polite"
            className="flex flex-col items-center justify-center text-center space-y-4 my-auto py-2"
          >
            <div className="p-3 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 rounded-full">
              <Inbox size={28} aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                No Account Found
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 max-w-xs">
                You haven't set up an account profile yet. Create one now to get started.
              </p>
            </div>

            {onCreateNew && (
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={onCreateNew}
                className="inline-flex items-center space-x-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white text-xs font-semibold rounded-lg shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 transition-colors"
              >
                <span>Create Profile</span>
                <ArrowRight size={14} className="shrink-0" />
              </motion.button>
            )}
          </motion.div>
        )}

        {/* State 4: Success */}
        {state === "success" && data && (
          <motion.div
            key="success"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={springTransition}
            aria-live="polite"
            className="space-y-5 w-full my-auto"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center space-x-3">
                <div className="p-2.5 bg-indigo-600 text-white rounded-xl font-bold text-sm">
                  {data.name
                    .split(" ")
                    .map((n) => n[0])
                    .join("")}
                </div>
                <div>
                  <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                    {data.name}
                    <ShieldCheck size={16} className="text-indigo-600 dark:text-indigo-400" />
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
                    <Mail size={12} />
                    {data.email}
                  </p>
                </div>
              </div>

              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                <CheckCircle2 size={12} className="mr-1" />
                {data.status}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
              <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
                <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider block">
                  Organization
                </span>
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1 mt-0.5">
                  <Building2 size={12} />
                  {data.company}
                </span>
              </div>
              <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
                <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider block">
                  Storage Used
                </span>
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 block mt-0.5">
                  {data.storageUsedGB} GB / 100 GB
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// Demo component to switch between all 4 states
export default function CardWithStatesExample() {
  const [currentState, setCurrentState] = useState<CardState>("success");

  const sampleData: AccountData = {
    name: "Alex Rivera",
    email: "alex.rivera@example.com",
    company: "Acme Cloud Inc.",
    status: "verified",
    storageUsedGB: 42.5,
  };

  return (
    <div className="p-8 max-w-2xl mx-auto space-y-6">
      <header className="space-y-1">
        <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
          Card With States Demo
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Seamless transitions between Loading, Empty, Error, and Success states.
        </p>
      </header>

      {/* State Switcher Buttons */}
      <div className="flex flex-wrap gap-2">
        {(["loading", "empty", "error", "success"] as CardState[]).map((state) => (
          <button
            key={state}
            onClick={() => setCurrentState(state)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
              currentState === state
                ? "bg-indigo-600 text-white shadow-sm"
                : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200"
            }`}
          >
            {state}
          </button>
        ))}
      </div>

      <div className="flex justify-center">
        <CardWithStates
          state={currentState}
          data={sampleData}
          onRetry={() => setCurrentState("loading")}
          onCreateNew={() => alert("Creating new profile...")}
        />
      </div>
    </div>
  );
}
