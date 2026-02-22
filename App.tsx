/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, Type, GenerateContentResponse, ThinkingLevel } from "@google/genai";
import { 
  FileText, 
  Upload, 
  Shield, 
  ChevronRight, 
  ChevronDown, 
  BookOpen, 
  Lightbulb, 
  CheckCircle2, 
  X, 
  Loader2,
  ArrowRight,
  BrainCircuit,
  Terminal
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Markdown from 'react-markdown';

// --- Types ---

interface OutlineTopic {
  topic: string;
  subtopics: string[];
}

interface QuizQuestion {
  id: number;
  type: 'mcq' | 'true_false' | 'short_answer';
  question: string;
  choices?: string[];
  answer: string;
  explanation?: string;
}

interface Quiz {
  title: string;
  topic: string;
  difficulty: 'easy' | 'medium' | 'hard';
  questions: QuizQuestion[];
}

interface ProjectIdea {
  title: string;
  description: string;
  difficulty: string;
  technologies: string[];
  tasks: string[];
  employerValue: string;
  advice: string;
  completionAdvice: string;
}

// --- Gemini Service ---

let genAIInstance: GoogleGenAI | null = null;

function getGenAI() {
  if (!genAIInstance) {
    // Check both process.env (mapped by Vite) and import.meta.env (Vite default)
    const apiKey = process.env.GEMINI_API_KEY || (import.meta as any).env?.VITE_GEMINI_API_KEY;
    
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is missing. Locally, ensure you have a .env file with GEMINI_API_KEY=your_key or VITE_GEMINI_API_KEY=your_key and restart your server.");
    }
    genAIInstance = new GoogleGenAI({ apiKey });
  }
  return genAIInstance;
}

const DEFENSIVE_RULES = `
You are generating study materials for cryptography + data/information security topics.
MUST be educational and defensive: definitions, concepts, comparisons, safe best practices.
Do NOT provide:
instructions to break into systems, exploit vulnerabilities, write malware, evade detection, or bypass security
step-by-step operational misuse (e.g., how to crack passwords in practice)
High-level awareness questions about attacks are okay (e.g., "What is a chosen-plaintext attack?"),
but not actionable steps to perform attacks.
`;

// --- Utilities ---

function extractJson(text: string): any {
  if (!text) throw new Error("Empty response from AI");
  
  let cleaned = text.trim();
  
  // 1. Try direct parse
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    // 2. Remove markdown code fences
    const withoutFences = cleaned.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
    try {
      return JSON.parse(withoutFences);
    } catch (e2) {
      // 3. Find the first { or [ and the last } or ]
      const firstBrace = cleaned.indexOf('{');
      const firstBracket = cleaned.indexOf('[');
      let start = -1;
      if (firstBrace !== -1 && firstBracket !== -1) start = Math.min(firstBrace, firstBracket);
      else if (firstBrace !== -1) start = firstBrace;
      else if (firstBracket !== -1) start = firstBracket;

      const lastBrace = cleaned.lastIndexOf('}');
      const lastBracket = cleaned.lastIndexOf(']');
      let end = -1;
      if (lastBrace !== -1 && lastBracket !== -1) end = Math.max(lastBrace, lastBracket);
      else if (lastBrace !== -1) end = lastBrace;
      else if (lastBracket !== -1) end = lastBracket;

      if (start !== -1 && end !== -1 && end > start) {
        const candidate = cleaned.substring(start, end + 1);
        try {
          return JSON.parse(candidate);
        } catch (e3) {
          console.error("Failed to parse candidate JSON:", candidate);
        }
      }
    }
  }
  throw new Error("The AI response was not in a valid format. This can happen if the input is too large or complex.");
}

// --- Components ---

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [syllabus, setSyllabus] = useState<OutlineTopic[] | null>(null);
  const [selectedTopic, setSelectedTopic] = useState<{ topic: string, subtopics: string[] } | null>(null);
  const [activeView, setActiveView] = useState<'none' | 'learn' | 'quiz' | 'project'>('none');
  const [content, setContent] = useState<any>(null);
  const [quizAnswers, setQuizAnswers] = useState<Record<number, string>>({});
  const [showResults, setShowResults] = useState(false);
  const [projectInput, setProjectInput] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFile = e.target.files?.[0];
    if (!uploadedFile) return;
    setFile(uploadedFile);
    await processSyllabus(uploadedFile);
  };

  const processSyllabus = async (file: File) => {
    setLoading(true);
    setStatus('Scanning syllabus...');
    try {
      const genAI = getGenAI();
      const base64 = await fileToBase64(file);
      const mimeType = file.type || (file.name.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');
      
      const response = await genAI.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            inlineData: {
              mimeType: mimeType,
              data: base64
            }
          },
          {
            text: "Extract topics and subtopics from this syllabus. Return a JSON array of objects with 'topic' (string) and 'subtopics' (array of strings). Limit to 10 topics."
          }
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                topic: { type: Type.STRING },
                subtopics: { type: Type.ARRAY, items: { type: Type.STRING } }
              },
              required: ["topic", "subtopics"]
            }
          }
        }
      });

      const data = extractJson(response.text);
      setSyllabus(data);
      setStatus('');
    } catch (error: any) {
      console.error(error);
      setStatus(error.message || 'Error processing syllabus.');
    } finally {
      setLoading(false);
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1];
        resolve(base64);
      };
      reader.onerror = error => reject(error);
    });
  };

  const startQuiz = async (topic: string, subtopics: string[]) => {
    setLoading(true);
    setActiveView('quiz');
    setContent(null);
    setQuizAnswers({});
    setShowResults(false);
    try {
      const genAI = getGenAI();
      const response = await genAI.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Generate a 5-question quiz for: ${topic}. Subtopics: ${subtopics.join(', ')}. ${DEFENSIVE_RULES}
        Include MCQ, True/False, and Short Answer.
        Return JSON with title, topic, difficulty, and questions array.
        Each question: id (int), type (mcq/true_false/short_answer), question (str), choices (array or empty), answer (str), explanation (str).`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              topic: { type: Type.STRING },
              difficulty: { type: Type.STRING },
              questions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.INTEGER },
                    type: { type: Type.STRING },
                    question: { type: Type.STRING },
                    choices: { type: Type.ARRAY, items: { type: Type.STRING } },
                    answer: { type: Type.STRING },
                    explanation: { type: Type.STRING }
                  },
                  required: ["id", "type", "question", "choices", "answer", "explanation"]
                }
              }
            },
            required: ["title", "topic", "difficulty", "questions"]
          }
        }
      });
      setContent(extractJson(response.text));
    } catch (error: any) {
      console.error(error);
      setContent({ error: error.message || 'Failed to generate quiz.' });
    } finally {
      setLoading(false);
    }
  };

  const startProject = async (topic: string, subtopics: string[], userPreference: string = '') => {
    setLoading(true);
    setActiveView('project');
    setContent(null);
    try {
      const genAI = getGenAI();
      const response = await genAI.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Create a beginner project idea for: ${topic}. Subtopics: ${subtopics.join(', ')}. Preference: ${userPreference || 'Any'}. ${DEFENSIVE_RULES}
        Return JSON with: title, description, difficulty, technologies (array), tasks (array), employerValue, advice, completionAdvice.`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              description: { type: Type.STRING },
              difficulty: { type: Type.STRING },
              technologies: { type: Type.ARRAY, items: { type: Type.STRING } },
              tasks: { type: Type.ARRAY, items: { type: Type.STRING } },
              employerValue: { type: Type.STRING },
              advice: { type: Type.STRING },
              completionAdvice: { type: Type.STRING }
            },
            required: ["title", "description", "difficulty", "technologies", "tasks", "employerValue", "advice", "completionAdvice"]
          }
        }
      });
      setContent(extractJson(response.text));
    } catch (error: any) {
      console.error(error);
      setContent({ error: error.message || 'Failed to generate project.' });
    } finally {
      setLoading(false);
    }
  };

  const startLearning = async (topic: string, subtopics: string[]) => {
    setLoading(true);
    setActiveView('learn');
    setContent(null);
    try {
      const genAI = getGenAI();
      const response = await genAI.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Provide a comprehensive learning guide for: ${topic}. Subtopics: ${subtopics.join(', ')}. ${DEFENSIVE_RULES}
        Format the output in Markdown. Include definitions, key concepts, and best practices.`,
      });
      setContent(response.text);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0A0A0B] text-zinc-100 font-sans selection:bg-emerald-500/30">
      {/* Header */}
      <header className="border-b border-white/5 bg-black/20 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-500/10 border border-emerald-500/20 rounded-lg flex items-center justify-center">
              <Shield className="w-6 h-6 text-emerald-500" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight">Syllabi<span className="text-emerald-500">Shield</span></h1>
          </div>
          <div className="flex items-center gap-4">
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-all text-sm font-medium shadow-lg shadow-emerald-500/20"
            >
              <Upload className="w-4 h-4" />
              Upload Syllabus
            </button>
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleFileUpload} 
              className="hidden" 
              accept=".pdf,image/*"
            />
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-12">
        {!syllabus ? (
          <div className="flex flex-col items-center justify-center py-32 text-center">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="max-w-2xl"
            >
              <div className="w-20 h-20 bg-emerald-500/5 border border-emerald-500/10 rounded-3xl flex items-center justify-center mx-auto mb-8">
                <FileText className="w-10 h-10 text-emerald-500/50" />
              </div>
              <h2 className="text-4xl font-bold mb-4 tracking-tight">Protect Your Learning Path</h2>
              <p className="text-zinc-400 text-lg mb-10">
                Upload your course syllabus to visualize topics, generate AI-powered projects, and test your knowledge with defensive security quizzes.
              </p>
              <div 
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const file = e.dataTransfer.files[0];
                  if (file) processSyllabus(file);
                }}
                className="border-2 border-dashed border-white/10 rounded-2xl p-12 hover:border-emerald-500/50 transition-colors cursor-pointer group"
                onClick={() => fileInputRef.current?.click()}
              >
                <div className="flex flex-col items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center group-hover:bg-emerald-500/10 transition-colors">
                    <Upload className="w-6 h-6 text-zinc-500 group-hover:text-emerald-500" />
                  </div>
                  <p className="text-sm text-zinc-500">Drag and drop PDF or Image, or click to browse</p>
                </div>
              </div>
            </motion.div>
          </div>
        ) : (
          <div className="space-y-12">
            {/* Flowchart / Directory Tree */}
            <section>
              <div className="flex items-center justify-between mb-8">
                <h3 className="text-sm font-semibold uppercase tracking-widest text-emerald-500/70 flex items-center gap-2">
                  <BrainCircuit className="w-4 h-4" />
                  Syllabus Structure
                </h3>
                <span className="text-xs text-zinc-500 font-mono">ROOT / {file?.name.toUpperCase()}</span>
              </div>
              
              <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-8 overflow-x-auto">
                <div className="min-w-[800px]">
                  <DirectoryTree topics={syllabus} />
                </div>
              </div>
            </section>

            {/* Category Grid */}
            <section>
              <h3 className="text-sm font-semibold uppercase tracking-widest text-emerald-500/70 mb-8 flex items-center gap-2">
                <Terminal className="w-4 h-4" />
                Topic Modules
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {syllabus.map((topic, idx) => (
                  <motion.button
                    key={idx}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: idx * 0.05 }}
                    onClick={() => setSelectedTopic(topic)}
                    className="group relative p-6 bg-white/[0.03] border border-white/5 rounded-xl text-left hover:bg-white/[0.05] hover:border-emerald-500/30 transition-all"
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-500">
                        <span className="text-xs font-bold font-mono">{(idx + 1).toString().padStart(2, '0')}</span>
                      </div>
                      <ArrowRight className="w-4 h-4 text-zinc-600 group-hover:text-emerald-500 transition-colors" />
                    </div>
                    <h4 className="font-semibold text-lg mb-2 group-hover:text-emerald-400 transition-colors">{topic.topic}</h4>
                    <p className="text-xs text-zinc-500 font-mono uppercase tracking-tighter">
                      {topic.subtopics.length} SUBTOPICS DETECTED
                    </p>
                  </motion.button>
                ))}
              </div>
            </section>
          </div>
        )}
      </main>

      {/* Modals */}
      <AnimatePresence>
        {selectedTopic && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                if (activeView === 'none') setSelectedTopic(null);
              }}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-2xl bg-[#121214] border border-white/10 rounded-3xl overflow-hidden shadow-2xl"
            >
              {activeView === 'none' ? (
                <div className="p-8">
                  <div className="flex items-center justify-between mb-8">
                    <div>
                      <h3 className="text-2xl font-bold mb-1">{selectedTopic.topic}</h3>
                      <p className="text-zinc-500 text-sm">Select an action to proceed with this module</p>
                    </div>
                    <button 
                      onClick={() => setSelectedTopic(null)}
                      className="p-2 hover:bg-white/5 rounded-full transition-colors"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 gap-4">
                    <ActionButton 
                      icon={<BookOpen className="w-5 h-5" />}
                      title="Learn Topic"
                      description="Get a comprehensive AI-generated guide on this module."
                      onClick={() => startLearning(selectedTopic.topic, selectedTopic.subtopics)}
                    />
                    <ActionButton 
                      icon={<Lightbulb className="w-5 h-5" />}
                      title="Build Project"
                      description="Generate a high-value project idea for your portfolio."
                      onClick={() => startProject(selectedTopic.topic, selectedTopic.subtopics)}
                    />
                    <ActionButton 
                      icon={<BrainCircuit className="w-5 h-5" />}
                      title="Take Quiz"
                      description="Test your knowledge with defensive security questions."
                      onClick={() => startQuiz(selectedTopic.topic, selectedTopic.subtopics)}
                    />
                  </div>
                </div>
              ) : (
                <div className="h-[80vh] flex flex-col">
                  <div className="p-6 border-b border-white/5 flex items-center justify-between bg-black/20">
                    <div className="flex items-center gap-3">
                      <button 
                        onClick={() => setActiveView('none')}
                        className="p-2 hover:bg-white/5 rounded-lg transition-colors"
                      >
                        <X className="w-5 h-5" />
                      </button>
                      <h3 className="font-semibold">{selectedTopic.topic} / {activeView.toUpperCase()}</h3>
                    </div>
                    {loading && <Loader2 className="w-5 h-5 animate-spin text-emerald-500" />}
                  </div>
                  
                  <div className="flex-1 overflow-y-auto p-8">
                    {loading ? (
                      <div className="h-full flex flex-col items-center justify-center text-center gap-4">
                        <div className="w-12 h-12 rounded-full border-2 border-emerald-500/20 border-t-emerald-500 animate-spin" />
                        <p className="text-zinc-500 animate-pulse">Consulting Gemini AI...</p>
                      </div>
                    ) : content?.error ? (
                      <div className="h-full flex flex-col items-center justify-center text-center gap-4">
                        <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center">
                          <X className="w-8 h-8 text-red-500" />
                        </div>
                        <h4 className="text-xl font-bold text-red-400">Generation Failed</h4>
                        <p className="text-zinc-500 max-w-sm">{content.error}</p>
                        <button 
                          onClick={() => setActiveView('none')}
                          className="mt-4 px-6 py-2 bg-white/5 hover:bg-white/10 rounded-lg transition-colors"
                        >
                          Try Again
                        </button>
                      </div>
                    ) : (
                      <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                        {activeView === 'learn' && (
                          <div className="prose prose-invert prose-emerald max-w-none markdown-body">
                            <Markdown>{content}</Markdown>
                          </div>
                        )}
                        
                        {activeView === 'project' && !content && !loading && (
                          <div className="space-y-6">
                            <div className="p-6 bg-white/5 border border-white/5 rounded-2xl">
                              <h4 className="text-xl font-bold mb-2">Customize Your Project</h4>
                              <p className="text-zinc-500 text-sm mb-6">Tell us what kind of project you're interested in (e.g., "Web App", "Mobile App", "CLI Tool", "Data Analysis").</p>
                              <div className="space-y-4">
                                <textarea 
                                  value={projectInput}
                                  onChange={(e) => setProjectInput(e.target.value)}
                                  placeholder="Enter your preferences..."
                                  className="w-full bg-black/40 border border-white/10 rounded-xl p-4 text-sm focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 outline-none transition-all min-h-[120px]"
                                />
                                <button 
                                  onClick={() => startProject(selectedTopic.topic, selectedTopic.subtopics, projectInput)}
                                  className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold transition-all flex items-center justify-center gap-2"
                                >
                                  Generate Project Idea
                                  <ArrowRight className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          </div>
                        )}

                        {activeView === 'project' && content && (
                          <div className="space-y-8">
                            <div>
                              <h4 className="text-3xl font-bold mb-4 text-emerald-400">{content.title}</h4>
                              <p className="text-zinc-300 text-lg leading-relaxed">{content.description}</p>
                            </div>
                            
                            <div className="grid grid-cols-2 gap-4">
                              <div className="p-4 bg-white/5 rounded-xl border border-white/5">
                                <span className="text-xs font-mono text-zinc-500 uppercase block mb-1">Difficulty</span>
                                <span className="font-medium">{content.difficulty}</span>
                              </div>
                              <div className="p-4 bg-white/5 rounded-xl border border-white/5">
                                <span className="text-xs font-mono text-zinc-500 uppercase block mb-1">Tech Stack</span>
                                <div className="flex flex-wrap gap-2 mt-1">
                                  {content.technologies?.map((t: string, i: number) => (
                                    <span key={i} className="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 text-[10px] rounded border border-emerald-500/20">{t}</span>
                                  ))}
                                </div>
                              </div>
                            </div>

                            <div>
                              <h5 className="font-semibold mb-4 flex items-center gap-2">
                                <Terminal className="w-4 h-4 text-emerald-500" />
                                Implementation Roadmap
                              </h5>
                              <ul className="space-y-3">
                                {content.tasks?.map((task: string, i: number) => (
                                  <li key={i} className="flex items-start gap-3 text-zinc-400">
                                    <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                                    {task}
                                  </li>
                                ))}
                              </ul>
                            </div>

                            <div>
                              <h5 className="font-semibold mb-4 flex items-center gap-2">
                                <Lightbulb className="w-4 h-4 text-emerald-500" />
                                How to Complete Successfully
                              </h5>
                              <div className="p-6 bg-white/[0.03] border border-white/5 rounded-2xl text-sm text-zinc-300 leading-relaxed">
                                <Markdown>{content.completionAdvice}</Markdown>
                              </div>
                            </div>

                            <div className="p-6 bg-emerald-500/5 border border-emerald-500/10 rounded-2xl">
                              <h5 className="font-semibold text-emerald-400 mb-2 flex items-center gap-2">
                                <Shield className="w-4 h-4" />
                                Employer Value Proposition
                              </h5>
                              <p className="text-sm text-zinc-300 italic mb-4">"{content.employerValue}"</p>
                              
                              <h5 className="font-semibold text-emerald-400 mb-2 flex items-center gap-2">
                                <Lightbulb className="w-4 h-4" />
                                Beginner Advice
                              </h5>
                              <p className="text-sm text-zinc-300 italic">"{content.advice}"</p>
                            </div>
                          </div>
                        )}

                        {activeView === 'quiz' && content && (
                          <div className="space-y-10">
                            {content.questions?.map((q: QuizQuestion, qIdx: number) => (
                              <div key={q.id} className="space-y-4">
                                <div className="flex items-start gap-4">
                                  <span className="w-8 h-8 rounded bg-white/5 flex items-center justify-center text-xs font-mono text-zinc-500 shrink-0">
                                    {(qIdx + 1).toString().padStart(2, '0')}
                                  </span>
                                  <p className="text-lg font-medium pt-0.5">{q.question}</p>
                                </div>
                                
                                <div className="grid grid-cols-1 gap-2 ml-12">
                                  {q.type === 'short_answer' ? (
                                    <div className="space-y-4">
                                      <textarea
                                        disabled={showResults}
                                        value={quizAnswers[q.id] || ''}
                                        onChange={(e) => setQuizAnswers(prev => ({ ...prev, [q.id]: e.target.value }))}
                                        placeholder="Type your answer here..."
                                        className="w-full bg-black/40 border border-white/10 rounded-xl p-4 text-sm focus:border-emerald-500/50 outline-none transition-all min-h-[100px]"
                                      />
                                      {showResults && (
                                        <div className="p-4 bg-emerald-500/10 border border-emerald-500/50 rounded-xl">
                                          <span className="text-xs font-mono text-emerald-500 uppercase block mb-1">Expected Answer</span>
                                          <p className="text-sm text-emerald-400">{q.answer}</p>
                                        </div>
                                      )}
                                    </div>
                                  ) : (
                                    q.choices?.map((choice, cIdx) => {
                                      const isSelected = quizAnswers[q.id] === choice;
                                      const isCorrect = choice === q.answer;
                                      let className = "p-4 rounded-xl border text-left transition-all ";
                                      
                                      if (showResults) {
                                        if (isCorrect) className += "bg-emerald-500/10 border-emerald-500/50 text-emerald-400";
                                        else if (isSelected) className += "bg-red-500/10 border-red-500/50 text-red-400";
                                        else className += "bg-white/5 border-white/5 opacity-50";
                                      } else {
                                        className += isSelected 
                                          ? "bg-emerald-500/10 border-emerald-500/50 text-emerald-400" 
                                          : "bg-white/5 border-white/5 hover:bg-white/10 hover:border-white/10";
                                      }

                                      return (
                                        <button
                                          key={cIdx}
                                          disabled={showResults}
                                          onClick={() => setQuizAnswers(prev => ({ ...prev, [q.id]: choice }))}
                                          className={className}
                                        >
                                          {choice}
                                        </button>
                                      );
                                    })
                                  )}
                                </div>

                                {showResults && q.explanation && (
                                  <motion.div 
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: 'auto' }}
                                    className="ml-12 p-4 bg-white/5 rounded-xl text-sm border-l-2 border-emerald-500"
                                  >
                                    {quizAnswers[q.id] && q.type === 'short_answer' && (
                                      <div className={`mb-2 flex items-center gap-2 font-bold uppercase text-[10px] tracking-widest ${
                                        quizAnswers[q.id].toLowerCase().trim() === q.answer.toLowerCase().trim() ? 'text-emerald-400' : 'text-red-400'
                                      }`}>
                                        {quizAnswers[q.id].toLowerCase().trim() === q.answer.toLowerCase().trim() ? (
                                          <><CheckCircle2 className="w-3 h-3" /> Correct Answer</>
                                        ) : (
                                          <><X className="w-3 h-3" /> Incorrect Answer</>
                                        )}
                                      </div>
                                    )}
                                    {quizAnswers[q.id] && q.type !== 'short_answer' && quizAnswers[q.id] !== q.answer && (
                                      <div className="mb-2 flex items-center gap-2 text-red-400 font-bold uppercase text-[10px] tracking-widest">
                                        <X className="w-3 h-3" />
                                        Incorrect Answer
                                      </div>
                                    )}
                                    <span className="font-semibold text-emerald-500 block mb-1">Explanation</span>
                                    <p className="text-zinc-400">{q.explanation}</p>
                                  </motion.div>
                                )}
                              </div>
                            ))}

                            {!showResults && (
                              <button
                                onClick={() => setShowResults(true)}
                                className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold transition-all shadow-lg shadow-emerald-500/20"
                              >
                                Submit Quiz
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Loading Overlay */}
      {loading && !selectedTopic && (
        <div className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-md flex flex-col items-center justify-center gap-6">
          <div className="relative">
            <div className="w-20 h-20 rounded-full border-4 border-emerald-500/20 border-t-emerald-500 animate-spin" />
            <Shield className="absolute inset-0 m-auto w-8 h-8 text-emerald-500 animate-pulse" />
          </div>
          <div className="text-center">
            <h4 className="text-xl font-bold mb-2">{status || 'Processing...'}</h4>
            <p className="text-zinc-500 text-sm">Gemini AI is analyzing your syllabus data</p>
          </div>
        </div>
      )}
    </div>
  );
}

function ActionButton({ icon, title, description, onClick }: { icon: React.ReactNode, title: string, description: string, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className="group p-6 bg-white/[0.03] border border-white/5 rounded-2xl text-left hover:bg-emerald-500/5 hover:border-emerald-500/30 transition-all flex items-start gap-6"
    >
      <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center text-zinc-400 group-hover:bg-emerald-500/10 group-hover:text-emerald-500 transition-all shrink-0">
        {icon}
      </div>
      <div>
        <h4 className="font-bold text-lg mb-1 group-hover:text-emerald-400 transition-colors">{title}</h4>
        <p className="text-zinc-500 text-sm leading-relaxed">{description}</p>
      </div>
      <ChevronRight className="w-5 h-5 text-zinc-700 group-hover:text-emerald-500 transition-colors ml-auto mt-1" />
    </button>
  );
}

function DirectoryTree({ topics }: { topics: OutlineTopic[] }) {
  return (
    <div className="font-mono text-sm">
      <div className="flex items-center gap-2 text-emerald-500 mb-4">
        <Shield className="w-4 h-4" />
        <span>SYLLABUS_ROOT</span>
      </div>
      <div className="space-y-1">
        {topics?.map((topic, idx) => (
          <TreeItem 
            key={idx} 
            label={topic.topic} 
            isLast={idx === topics.length - 1}
            children={topic.subtopics}
          />
        ))}
      </div>
    </div>
  );
}

function TreeItem({ label, children, isLast, depth = 0 }: { label: string, children?: string[], isLast: boolean, depth?: number }) {
  const [isOpen, setIsOpen] = useState(true);
  
  return (
    <div>
      <div className="flex items-center group cursor-pointer" onClick={() => setIsOpen(!isOpen)}>
        <span className="text-zinc-700 mr-2">
          {depth === 0 ? (isLast ? '└──' : '├──') : (isLast ? '    └──' : '    ├──')}
        </span>
        <div className="flex items-center gap-2 px-2 py-1 rounded hover:bg-white/5 transition-colors">
          {children && children.length > 0 ? (
            isOpen ? <ChevronDown className="w-3 h-3 text-zinc-500" /> : <ChevronRight className="w-3 h-3 text-zinc-500" />
          ) : (
            <div className="w-3" />
          )}
          <FileText className="w-3.5 h-3.5 text-emerald-500/50" />
          <span className="text-zinc-300 group-hover:text-emerald-400 transition-colors">{label}</span>
        </div>
      </div>
      
      {isOpen && children && Array.isArray(children) && (
        <div className="ml-4">
          {children.map((child, idx) => (
            <div key={idx} className="flex items-center">
              <span className="text-zinc-700 mr-2">
                {isLast ? '    ' : '│   '}
                {idx === children.length - 1 ? '└──' : '├──'}
              </span>
              <div className="flex items-center gap-2 px-2 py-1">
                <div className="w-3" />
                <div className="w-1.5 h-1.5 rounded-full bg-zinc-700" />
                <span className="text-zinc-500">{child}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
