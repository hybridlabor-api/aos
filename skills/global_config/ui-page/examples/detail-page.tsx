import React, { useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Share2,
  MoreVertical,
  Calendar,
  Clock,
  User,
  ShieldCheck,
  CheckCircle2,
  FileText,
  Activity,
  ExternalLink,
  Download,
  AlertCircle,
} from "lucide-react";

export interface DetailPageProps {
  onBack?: () => void;
}

const springPhysics = {
  type: "spring",
  stiffness: 380,
  damping: 26,
};

export default function DetailPage({ onBack = () => {} }: DetailPageProps) {
  const [activeTab, setActiveTab] = useState<"overview" | "history" | "documents">("overview");

  const timelineEvents = [
    {
      id: "1",
      title: "Project Approved",
      date: "Aug 12, 2026 at 14:32",
      author: "Sarah Jenkins",
      status: "completed",
    },
    {
      id: "2",
      title: "Security Audit Passed",
      date: "Aug 10, 2026 at 09:15",
      author: "Security Bot",
      status: "completed",
    },
    {
      id: "3",
      title: "Deployment Initiated",
      date: "Aug 08, 2026 at 18:40",
      author: "Alex Rivera",
      status: "completed",
    },
  ];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 pb-12">
      {/* Sticky Header with Back Navigation */}
      <header className="sticky top-0 z-30 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 px-4 sm:px-6 py-3.5 flex items-center justify-between shadow-xs">
        <div className="flex items-center space-x-3">
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            transition={springPhysics}
            onClick={onBack}
            className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            aria-label="Navigate back"
          >
            <ArrowLeft size={18} />
          </motion.button>

          <div>
            <div className="flex items-center space-x-2">
              <span className="text-xs font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-950/70 dark:text-indigo-300">
                PROJ-2026
              </span>
              <span className="text-xs text-slate-500 font-medium">v2.4.0</span>
            </div>
            <h1 className="text-base sm:text-lg font-bold leading-tight line-clamp-1">
              Enterprise Neural Processing Pipeline
            </h1>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="p-2 rounded-xl text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            aria-label="Share resource"
          >
            <Share2 size={18} />
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="p-2 rounded-xl text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            aria-label="More options"
          >
            <MoreVertical size={18} />
          </motion.button>
        </div>
      </header>

      {/* Main Content Area following 8pt spatial grid */}
      <main className="max-w-5xl mx-auto px-4 sm:px-6 pt-6 space-y-6">
        {/* Hero Section */}
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center space-x-2">
                <h2 className="text-2xl font-bold">Enterprise Neural Pipeline</h2>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                  <CheckCircle2 size={12} className="mr-1" />
                  Active
                </span>
              </div>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                High-throughput automated data ingestion and embedding engine for StyleSeed.
              </p>
            </div>

            <div className="flex items-center space-x-3">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                transition={springPhysics}
                className="inline-flex items-center space-x-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-xs rounded-xl shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 transition-colors"
              >
                <Download size={14} />
                <span>Export Report</span>
              </motion.button>
            </div>
          </div>

          {/* Metric Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 border-t border-slate-100 dark:border-slate-800">
            <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl space-y-0.5">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                Uptime
              </span>
              <div className="text-lg font-bold text-slate-900 dark:text-slate-100">99.98%</div>
            </div>
            <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl space-y-0.5">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                Throughput
              </span>
              <div className="text-lg font-bold text-slate-900 dark:text-slate-100">14.2k req/s</div>
            </div>
            <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl space-y-0.5">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                Avg Latency
              </span>
              <div className="text-lg font-bold text-slate-900 dark:text-slate-100">42 ms</div>
            </div>
            <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl space-y-0.5">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                Error Rate
              </span>
              <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400">0.001%</div>
            </div>
          </div>
        </section>

        {/* Tab Navigation Section */}
        <section className="space-y-4">
          <div className="flex border-b border-slate-200 dark:border-slate-800 space-x-6">
            {(["overview", "history", "documents"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`py-3 text-sm font-semibold capitalize transition-colors relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                  activeTab === tab
                    ? "text-indigo-600 dark:text-indigo-400"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                }`}
              >
                {tab}
                {activeTab === tab && (
                  <motion.div
                    layoutId="activeTabIndicator"
                    transition={springPhysics}
                    className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600 dark:bg-indigo-400 rounded-full"
                  />
                )}
              </button>
            ))}
          </div>

          {/* Tab 1: Overview */}
          {activeTab === "overview" && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={springPhysics}
              className="grid grid-cols-1 md:grid-cols-3 gap-6"
            >
              {/* Main Specification Card */}
              <div className="md:col-span-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-4">
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  System Metadata
                </h3>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl space-y-1">
                    <dt className="text-slate-500 font-medium">Cluster Architecture</dt>
                    <dd className="font-semibold text-slate-800 dark:text-slate-200">
                      Multi-Region Kubernetes (EKS)
                    </dd>
                  </div>
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl space-y-1">
                    <dt className="text-slate-500 font-medium">Primary Region</dt>
                    <dd className="font-semibold text-slate-800 dark:text-slate-200">
                      us-east-1 (N. Virginia)
                    </dd>
                  </div>
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl space-y-1">
                    <dt className="text-slate-500 font-medium">Security Certification</dt>
                    <dd className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1">
                      <ShieldCheck size={14} className="text-indigo-600" />
                      SOC-2 Type II Verified
                    </dd>
                  </div>
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl space-y-1">
                    <dt className="text-slate-500 font-medium">Last Audit</dt>
                    <dd className="font-semibold text-slate-800 dark:text-slate-200">
                      August 10, 2026
                    </dd>
                  </div>
                </dl>
              </div>

              {/* Sidebar Quick Card */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-4">
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Lead Owner
                </h3>
                <div className="flex items-center space-x-3">
                  <div className="h-10 w-10 rounded-full bg-indigo-600 text-white font-bold flex items-center justify-center text-sm">
                    SJ
                  </div>
                  <div>
                    <div className="text-sm font-bold">Sarah Jenkins</div>
                    <div className="text-xs text-slate-500">Principal Architect</div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* Tab 2: Activity History */}
          {activeTab === "history" && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={springPhysics}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-6"
            >
              <h3 className="text-base font-bold">Activity Audit Log</h3>
              <div className="relative pl-6 border-l-2 border-slate-200 dark:border-slate-800 space-y-6">
                {timelineEvents.map((event) => (
                  <div key={event.id} className="relative">
                    <span className="absolute -left-[31px] top-1.5 w-3 h-3 rounded-full bg-indigo-600 ring-4 ring-white dark:ring-slate-900" />
                    <div>
                      <h4 className="text-sm font-semibold">{event.title}</h4>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Triggered by <span className="font-medium text-slate-700 dark:text-slate-300">{event.author}</span> • {event.date}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* Tab 3: Documents */}
          {activeTab === "documents" && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={springPhysics}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-4"
            >
              <h3 className="text-base font-bold">Attached Documentation</h3>
              <div className="space-y-3">
                {["System Architecture Spec v2.pdf", "Security Compliance Report.pdf"].map((doc) => (
                  <div
                    key={doc}
                    className="flex items-center justify-between p-3.5 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-800"
                  >
                    <div className="flex items-center space-x-3">
                      <FileText className="text-indigo-600 dark:text-indigo-400" size={18} />
                      <span className="text-xs font-semibold">{doc}</span>
                    </div>
                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      className="p-1.5 rounded-lg text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
                      aria-label={`Download ${doc}`}
                    >
                      <Download size={16} />
                    </motion.button>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </section>
      </main>
    </div>
  );
}
