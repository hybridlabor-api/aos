import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Check,
  ChevronRight,
  ChevronLeft,
  User,
  Building,
  CreditCard,
  CheckCircle2,
  AlertCircle,
  Sparkles,
} from "lucide-react";

export interface Step {
  id: number;
  title: string;
  description: string;
  icon: React.ReactNode;
}

const steps: Step[] = [
  {
    id: 1,
    title: "Account Info",
    description: "Personal credentials",
    icon: <User size={16} />,
  },
  {
    id: 2,
    title: "Organization",
    description: "Company details",
    icon: <Building size={16} />,
  },
  {
    id: 3,
    title: "Billing Plan",
    description: "Select subscription",
    icon: <CreditCard size={16} />,
  },
  {
    id: 4,
    title: "Review & Submit",
    description: "Final verification",
    icon: <CheckCircle2 size={16} />,
  },
];

const springPhysics = {
  type: "spring",
  stiffness: 380,
  damping: 26,
};

export default function FormWizardPattern() {
  const [currentStep, setCurrentStep] = useState(1);
  const [direction, setDirection] = useState(1);
  const [isSubmitted, setIsSubmitted] = useState(false);

  // Form State
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [teamSize, setTeamSize] = useState("1-10");
  const [selectedPlan, setSelectedPlan] = useState<"starter" | "pro" | "enterprise">("pro");

  // Error State
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validateStep = (step: number): boolean => {
    const newErrors: Record<string, string> = {};

    if (step === 1) {
      if (!fullName.trim()) newErrors.fullName = "Full name is required";
      if (!email.trim()) {
        newErrors.email = "Email address is required";
      } else if (!/\S+@\S+\.\S+/.test(email)) {
        newErrors.email = "Enter a valid email address";
      }
    } else if (step === 2) {
      if (!companyName.trim()) newErrors.companyName = "Company name is required";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleNext = () => {
    if (validateStep(currentStep)) {
      setDirection(1);
      setCurrentStep((prev) => Math.min(prev + 1, steps.length));
    }
  };

  const handleBack = () => {
    setDirection(-1);
    setErrors({});
    setCurrentStep((prev) => Math.max(prev - 1, 1));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validateStep(currentStep)) {
      setIsSubmitted(true);
    }
  };

  const handleReset = () => {
    setIsSubmitted(false);
    setCurrentStep(1);
    setFullName("");
    setEmail("");
    setCompanyName("");
    setSelectedPlan("pro");
    setErrors({});
  };

  return (
    <div className="p-6 sm:p-8 max-w-3xl mx-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm space-y-8">
      {/* Header */}
      <header className="space-y-1">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <Sparkles className="text-indigo-600 dark:text-indigo-400" size={24} />
          Multi-Step Form Wizard
        </h2>
        <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400">
          Guided setup wizard with per-step validation, spring slide transitions, and accessibility.
        </p>
      </header>

      {/* Step Indicator Header */}
      {!isSubmitted && (
        <nav aria-label="Form Progress" className="space-y-4">
          <div className="flex items-center justify-between">
            {steps.map((step) => {
              const isCompleted = currentStep > step.id;
              const isCurrent = currentStep === step.id;

              return (
                <div key={step.id} className="flex flex-col items-center space-y-1.5 flex-1">
                  <motion.div
                    animate={{
                      scale: isCurrent ? 1.1 : 1,
                    }}
                    transition={springPhysics}
                    className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                      isCompleted
                        ? "bg-emerald-600 text-white"
                        : isCurrent
                        ? "bg-indigo-600 text-white shadow-sm ring-4 ring-indigo-100 dark:ring-indigo-950"
                        : "bg-slate-100 dark:bg-slate-800 text-slate-500"
                    }`}
                    aria-current={isCurrent ? "step" : undefined}
                  >
                    {isCompleted ? <Check size={16} /> : step.icon}
                  </motion.div>
                  <span
                    className={`text-[11px] font-medium hidden sm:block ${
                      isCurrent
                        ? "text-indigo-600 dark:text-indigo-400 font-semibold"
                        : "text-slate-500"
                    }`}
                  >
                    {step.title}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Progress Bar */}
          <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
            <motion.div
              initial={{ width: "0%" }}
              animate={{ width: `${((currentStep - 1) / (steps.length - 1)) * 100}%` }}
              transition={springPhysics}
              className="h-full bg-indigo-600 dark:bg-indigo-500"
            />
          </div>
        </nav>
      )}

      {/* Form Content */}
      {isSubmitted ? (
        /* Final Success State */
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={springPhysics}
          className="text-center py-10 space-y-4"
        >
          <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle2 size={36} />
          </div>
          <div className="space-y-1">
            <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100">
              Account Created Successfully!
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400 max-w-sm mx-auto">
              Welcome aboard, <strong>{fullName}</strong>. A confirmation email has been sent to{" "}
              <strong>{email}</strong>.
            </p>
          </div>

          <button
            onClick={handleReset}
            className="px-5 py-2.5 bg-indigo-600 text-white font-medium text-xs rounded-xl hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            Start Over
          </button>
        </motion.div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={currentStep}
              custom={direction}
              initial={{ opacity: 0, x: direction * 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -direction * 20 }}
              transition={springPhysics}
              className="space-y-4"
            >
              {/* Step 1: Personal Info */}
              {currentStep === 1 && (
                <div className="space-y-4">
                  <h3 className="text-base font-semibold border-b border-slate-100 dark:border-slate-800 pb-2">
                    Step 1: Personal Account Info
                  </h3>

                  <div>
                    <label
                      htmlFor="full-name-input"
                      className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1"
                    >
                      Full Name *
                    </label>
                    <input
                      id="full-name-input"
                      type="text"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Jane Doe"
                      aria-invalid={!!errors.fullName}
                      aria-describedby={errors.fullName ? "fullname-error" : undefined}
                      className={`w-full px-3.5 py-2.5 rounded-xl border text-sm bg-white dark:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                        errors.fullName
                          ? "border-red-500 text-red-900 focus-visible:ring-red-500"
                          : "border-slate-300 dark:border-slate-700"
                      }`}
                    />
                    {errors.fullName && (
                      <p id="fullname-error" className="text-xs text-red-500 mt-1 flex items-center gap-1">
                        <AlertCircle size={12} /> {errors.fullName}
                      </p>
                    )}
                  </div>

                  <div>
                    <label
                      htmlFor="email-input"
                      className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1"
                    >
                      Work Email *
                    </label>
                    <input
                      id="email-input"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="jane@company.com"
                      aria-invalid={!!errors.email}
                      aria-describedby={errors.email ? "email-error" : undefined}
                      className={`w-full px-3.5 py-2.5 rounded-xl border text-sm bg-white dark:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                        errors.email
                          ? "border-red-500 text-red-900 focus-visible:ring-red-500"
                          : "border-slate-300 dark:border-slate-700"
                      }`}
                    />
                    {errors.email && (
                      <p id="email-error" className="text-xs text-red-500 mt-1 flex items-center gap-1">
                        <AlertCircle size={12} /> {errors.email}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Step 2: Organization Info */}
              {currentStep === 2 && (
                <div className="space-y-4">
                  <h3 className="text-base font-semibold border-b border-slate-100 dark:border-slate-800 pb-2">
                    Step 2: Organization Details
                  </h3>

                  <div>
                    <label
                      htmlFor="company-input"
                      className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1"
                    >
                      Company Name *
                    </label>
                    <input
                      id="company-input"
                      type="text"
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      placeholder="Acme Inc."
                      aria-invalid={!!errors.companyName}
                      aria-describedby={errors.companyName ? "company-error" : undefined}
                      className={`w-full px-3.5 py-2.5 rounded-xl border text-sm bg-white dark:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                        errors.companyName
                          ? "border-red-500 focus-visible:ring-red-500"
                          : "border-slate-300 dark:border-slate-700"
                      }`}
                    />
                    {errors.companyName && (
                      <p id="company-error" className="text-xs text-red-500 mt-1 flex items-center gap-1">
                        <AlertCircle size={12} /> {errors.companyName}
                      </p>
                    )}
                  </div>

                  <div>
                    <label
                      htmlFor="team-size-select"
                      className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1"
                    >
                      Team Size
                    </label>
                    <select
                      id="team-size-select"
                      value={teamSize}
                      onChange={(e) => setTeamSize(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 text-sm bg-white dark:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    >
                      <option value="1-10">1-10 Employees</option>
                      <option value="11-50">11-50 Employees</option>
                      <option value="51-200">51-200 Employees</option>
                      <option value="201+">201+ Enterprise</option>
                    </select>
                  </div>
                </div>
              )}

              {/* Step 3: Billing Plan */}
              {currentStep === 3 && (
                <div className="space-y-4">
                  <h3 className="text-base font-semibold border-b border-slate-100 dark:border-slate-800 pb-2">
                    Step 3: Select Plan
                  </h3>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {[
                      { id: "starter", name: "Starter", price: "$19/mo" },
                      { id: "pro", name: "Pro", price: "$49/mo" },
                      { id: "enterprise", name: "Enterprise", price: "Custom" },
                    ].map((plan) => (
                      <button
                        key={plan.id}
                        type="button"
                        onClick={() => setSelectedPlan(plan.id as any)}
                        className={`p-4 rounded-xl border flex flex-col items-center justify-center space-y-1.5 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                          selectedPlan === plan.id
                            ? "border-indigo-600 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300"
                            : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                        }`}
                      >
                        <span className="text-xs font-semibold">{plan.name}</span>
                        <span className="text-lg font-bold">{plan.price}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Step 4: Review Summary */}
              {currentStep === 4 && (
                <div className="space-y-4">
                  <h3 className="text-base font-semibold border-b border-slate-100 dark:border-slate-800 pb-2">
                    Step 4: Review & Confirm
                  </h3>

                  <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl space-y-3 text-xs">
                    <div className="flex justify-between border-b border-slate-200 dark:border-slate-700 pb-2">
                      <span className="text-slate-500">Name</span>
                      <span className="font-semibold">{fullName}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-200 dark:border-slate-700 pb-2">
                      <span className="text-slate-500">Email</span>
                      <span className="font-semibold">{email}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-200 dark:border-slate-700 pb-2">
                      <span className="text-slate-500">Company</span>
                      <span className="font-semibold">{companyName} ({teamSize})</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Plan</span>
                      <span className="font-semibold capitalize">{selectedPlan} Plan</span>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>

          {/* Navigation Controls */}
          <div className="flex items-center justify-between pt-4 border-t border-slate-100 dark:border-slate-800">
            {currentStep > 1 ? (
              <motion.button
                type="button"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleBack}
                className="inline-flex items-center space-x-1 px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 rounded-xl hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                <ChevronLeft size={16} />
                <span>Back</span>
              </motion.button>
            ) : (
              <div />
            )}

            {currentStep < steps.length ? (
              <motion.button
                type="button"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleNext}
                className="inline-flex items-center space-x-1 px-5 py-2.5 text-xs font-semibold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 shadow-sm"
              >
                <span>Next</span>
                <ChevronRight size={16} />
              </motion.button>
            ) : (
              <motion.button
                type="submit"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="inline-flex items-center space-x-1 px-6 py-2.5 text-xs font-semibold text-white bg-emerald-600 rounded-xl hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 shadow-sm"
              >
                <span>Confirm & Submit</span>
                <Check size={16} />
              </motion.button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
