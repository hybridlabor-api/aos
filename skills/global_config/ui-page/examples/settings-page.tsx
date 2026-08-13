import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  User,
  Bell,
  Shield,
  Palette,
  ChevronRight,
  ArrowLeft,
  Check,
  Moon,
  Sun,
  Laptop,
  Mail,
  Lock,
  Smartphone,
  Globe,
  Save,
} from "lucide-react";

export type SettingsTab = "account" | "notifications" | "security" | "appearance";

export interface SettingsTabConfig {
  id: SettingsTab;
  label: string;
  description: string;
  icon: React.ReactNode;
}

const tabs: SettingsTabConfig[] = [
  {
    id: "account",
    label: "Account",
    description: "Manage your personal profile and email preferences",
    icon: <User size={18} />,
  },
  {
    id: "notifications",
    label: "Notifications",
    description: "Customize alert channels and message frequency",
    icon: <Bell size={18} />,
  },
  {
    id: "security",
    label: "Security",
    description: "Configure two-factor authentication and passwords",
    icon: <Shield size={18} />,
  },
  {
    id: "appearance",
    label: "Appearance",
    description: "Adjust interface theme, density, and contrast",
    icon: <Palette size={18} />,
  },
];

const springPhysics = {
  type: "spring",
  stiffness: 380,
  damping: 26,
};

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("account");
  // Controls mobile hub-and-spoke drill down vs menu view
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  // Form State
  const [name, setName] = useState("Jane Doe");
  const [email, setEmail] = useState("jane.doe@example.com");
  const [emailAlerts, setEmailAlerts] = useState(true);
  const [pushAlerts, setPushAlerts] = useState(true);
  const [twoFactor, setTwoFactor] = useState(false);
  const [theme, setTheme] = useState<"system" | "light" | "dark">("system");

  const handleTabSelect = (tabId: SettingsTab) => {
    setActiveTab(tabId);
    setMobileDetailOpen(true);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2500);
  };

  const activeTabConfig = tabs.find((t) => t.id === activeTab)!;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 p-4 sm:p-6 lg:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Page Header */}
        <header className="border-b border-slate-200 dark:border-slate-800 pb-5">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            Settings & Preferences
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Manage your account settings, security options, and UI preferences.
          </p>
        </header>

        {/* Saved Toast Notification */}
        <AnimatePresence>
          {savedSuccess && (
            <motion.div
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={springPhysics}
              role="status"
              className="p-4 rounded-xl bg-emerald-600 text-white flex items-center justify-between shadow-lg"
            >
              <div className="flex items-center space-x-2">
                <Check size={18} />
                <span className="text-sm font-medium">Changes saved successfully!</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Layout Container: Desktop Grid vs Mobile Hub-and-Spoke */}
        <div className="lg:grid lg:grid-cols-12 lg:gap-8 items-start">
          {/* Navigation Sidebar (Visible on desktop, or mobile when no detail open) */}
          <nav
            aria-label="Settings categories"
            className={`lg:col-span-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-2 shadow-sm ${
              mobileDetailOpen ? "hidden lg:block" : "block"
            }`}
          >
            <div className="space-y-1">
              {tabs.map((tab) => {
                const isActive = activeTab === tab.id;
                return (
                  <motion.button
                    key={tab.id}
                    onClick={() => handleTabSelect(tab.id)}
                    whileHover={{ x: 2 }}
                    whileTap={{ scale: 0.98 }}
                    transition={springPhysics}
                    className={`w-full flex items-center justify-between p-3.5 rounded-xl text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                      isActive
                        ? "bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 font-semibold"
                        : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                    }`}
                    aria-current={isActive ? "page" : undefined}
                  >
                    <div className="flex items-center space-x-3">
                      <span
                        className={`p-2 rounded-lg ${
                          isActive
                            ? "bg-indigo-600 text-white"
                            : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
                        }`}
                      >
                        {tab.icon}
                      </span>
                      <div>
                        <div className="text-sm font-medium">{tab.label}</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 line-clamp-1">
                          {tab.description}
                        </div>
                      </div>
                    </div>
                    <ChevronRight
                      size={16}
                      className={`text-slate-400 lg:hidden transition-transform ${
                        isActive ? "rotate-90 lg:rotate-0" : ""
                      }`}
                    />
                  </motion.button>
                );
              })}
            </div>
          </nav>

          {/* Content Spoke View (Desktop always shows active tab, Mobile shows when detailed open) */}
          <main
            className={`lg:col-span-8 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm mt-4 lg:mt-0 ${
              !mobileDetailOpen ? "hidden lg:block" : "block"
            }`}
          >
            {/* Mobile Back Header */}
            <div className="lg:hidden mb-6 flex items-center space-x-3 border-b border-slate-100 dark:border-slate-800 pb-4">
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setMobileDetailOpen(false)}
                className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                aria-label="Back to settings menu"
              >
                <ArrowLeft size={18} />
              </motion.button>
              <div>
                <h2 className="text-lg font-bold">{activeTabConfig.label}</h2>
                <p className="text-xs text-slate-500">{activeTabConfig.description}</p>
              </div>
            </div>

            {/* Tab Content Section */}
            <form onSubmit={handleSave} className="space-y-6">
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeTab}
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  transition={springPhysics}
                  className="space-y-6"
                >
                  {/* Account Tab */}
                  {activeTab === "account" && (
                    <div className="space-y-6">
                      <div className="border-b border-slate-100 dark:border-slate-800 pb-4 hidden lg:block">
                        <h2 className="text-xl font-bold">Account Profile</h2>
                        <p className="text-xs text-slate-500">
                          Update your personal information and account defaults.
                        </p>
                      </div>

                      <div className="space-y-4">
                        <div>
                          <label
                            htmlFor="full-name"
                            className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5"
                          >
                            Full Name
                          </label>
                          <input
                            id="full-name"
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 transition-colors"
                          />
                        </div>

                        <div>
                          <label
                            htmlFor="email-addr"
                            className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5"
                          >
                            Email Address
                          </label>
                          <div className="relative">
                            <Mail
                              size={16}
                              className="absolute left-3 top-3 text-slate-400"
                            />
                            <input
                              id="email-addr"
                              type="email"
                              value={email}
                              onChange={(e) => setEmail(e.target.value)}
                              className="w-full pl-9 pr-3.5 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 transition-colors"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Notifications Tab */}
                  {activeTab === "notifications" && (
                    <div className="space-y-6">
                      <div className="border-b border-slate-100 dark:border-slate-800 pb-4 hidden lg:block">
                        <h2 className="text-xl font-bold">Notification Preferences</h2>
                        <p className="text-xs text-slate-500">
                          Choose how and when you want to receive updates.
                        </p>
                      </div>

                      <div className="space-y-4">
                        <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-800">
                          <div>
                            <span className="text-sm font-semibold block">Email Digest</span>
                            <span className="text-xs text-slate-500">
                              Receive weekly summaries and account alerts via email.
                            </span>
                          </div>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={emailAlerts}
                            onClick={() => setEmailAlerts(!emailAlerts)}
                            className={`w-12 h-6 flex items-center rounded-full p-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                              emailAlerts ? "bg-indigo-600 justify-end" : "bg-slate-300 dark:bg-slate-700 justify-start"
                            }`}
                          >
                            <motion.div
                              layout
                              transition={springPhysics}
                              className="w-4 h-4 rounded-full bg-white shadow-md"
                            />
                          </button>
                        </div>

                        <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-800">
                          <div>
                            <span className="text-sm font-semibold block">Push Notifications</span>
                            <span className="text-xs text-slate-500">
                              Receive real-time mobile push notifications.
                            </span>
                          </div>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={pushAlerts}
                            onClick={() => setPushAlerts(!pushAlerts)}
                            className={`w-12 h-6 flex items-center rounded-full p-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                              pushAlerts ? "bg-indigo-600 justify-end" : "bg-slate-300 dark:bg-slate-700 justify-start"
                            }`}
                          >
                            <motion.div
                              layout
                              transition={springPhysics}
                              className="w-4 h-4 rounded-full bg-white shadow-md"
                            />
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Security Tab */}
                  {activeTab === "security" && (
                    <div className="space-y-6">
                      <div className="border-b border-slate-100 dark:border-slate-800 pb-4 hidden lg:block">
                        <h2 className="text-xl font-bold">Security Settings</h2>
                        <p className="text-xs text-slate-500">
                          Keep your account secure with two-factor authentication.
                        </p>
                      </div>

                      <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-800">
                        <div className="flex items-start space-x-3">
                          <Smartphone className="mt-0.5 text-indigo-600 dark:text-indigo-400" size={20} />
                          <div>
                            <span className="text-sm font-semibold block">Two-Factor Authentication (2FA)</span>
                            <span className="text-xs text-slate-500">
                              Require an authentication app code when signing in.
                            </span>
                          </div>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={twoFactor}
                          onClick={() => setTwoFactor(!twoFactor)}
                          className={`w-12 h-6 flex items-center rounded-full p-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                            twoFactor ? "bg-indigo-600 justify-end" : "bg-slate-300 dark:bg-slate-700 justify-start"
                          }`}
                        >
                          <motion.div
                            layout
                            transition={springPhysics}
                            className="w-4 h-4 rounded-full bg-white shadow-md"
                          />
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Appearance Tab */}
                  {activeTab === "appearance" && (
                    <div className="space-y-6">
                      <div className="border-b border-slate-100 dark:border-slate-800 pb-4 hidden lg:block">
                        <h2 className="text-xl font-bold">Appearance</h2>
                        <p className="text-xs text-slate-500">
                          Customize how StyleSeed UI renders on your device.
                        </p>
                      </div>

                      <div className="grid grid-cols-3 gap-3">
                        {[
                          { id: "light", label: "Light", icon: <Sun size={18} /> },
                          { id: "dark", label: "Dark", icon: <Moon size={18} /> },
                          { id: "system", label: "System", icon: <Laptop size={18} /> },
                        ].map((mode) => (
                          <button
                            key={mode.id}
                            type="button"
                            onClick={() => setTheme(mode.id as any)}
                            className={`p-4 rounded-xl border flex flex-col items-center justify-center space-y-2 text-xs font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                              theme === mode.id
                                ? "border-indigo-600 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-300"
                                : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50"
                            }`}
                          >
                            {mode.icon}
                            <span>{mode.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>

              {/* Form Action Buttons */}
              <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex justify-end">
                <motion.button
                  type="submit"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.97 }}
                  transition={springPhysics}
                  className="inline-flex items-center space-x-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-sm rounded-xl shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 transition-colors"
                >
                  <Save size={16} />
                  <span>Save Changes</span>
                </motion.button>
              </div>
            </form>
          </main>
        </div>
      </div>
    </div>
  );
}
