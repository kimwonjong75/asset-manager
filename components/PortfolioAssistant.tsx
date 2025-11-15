import React, { useState, useRef, useEffect } from 'react';
import { Asset } from '../types';
import { askPortfolioQuestion } from '../services/geminiService';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';


interface PortfolioAssistantProps {
  isOpen: boolean;
  onClose: () => void;
  assets: Asset[];
}

interface Message {
    role: 'user' | 'model';
    content: string;
}

const ASSISTANT_HISTORY_KEY = 'quant-assistant-history';

const PortfolioAssistant: React.FC<PortfolioAssistantProps> = ({ isOpen, onClose, assets }) => {
    const [messages, setMessages] = useState<Message[]>(() => {
        try {
            const savedHistory = localStorage.getItem(ASSISTANT_HISTORY_KEY);
            return savedHistory ? JSON.parse(savedHistory) : [];
        } catch (error) {
            console.error("Failed to load assistant history:", error);
            return [];
        }
    });

    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(scrollToBottom, [messages, isLoading]);
    
    useEffect(() => {
      if (isOpen) {
        setTimeout(() => inputRef.current?.focus(), 100);
      }
    }, [isOpen]);

    useEffect(() => {
        try {
            localStorage.setItem(ASSISTANT_HISTORY_KEY, JSON.stringify(messages));
        } catch (error) {
            console.error("Failed to save assistant history:", error);
        }
    }, [messages]);


    const handleSend = async () => {
        if (!input.trim() || isLoading) return;

        const userMessage: Message = { role: 'user', content: input };
        setMessages(prev => [...prev, userMessage]);
        setInput('');
        setIsLoading(true);

        try {
            const modelResponse = await askPortfolioQuestion(assets, input);
            const assistantMessage: Message = { role: 'model', content: modelResponse };
            setMessages(prev => [...prev, assistantMessage]);
        } catch (error) {
            console.error("Error asking portfolio question:", error);
            const errorMessage: Message = { role: 'model', content: "죄송합니다, 답변을 생성하는 중에 오류가 발생했습니다. 잠시 후 다시 시도해주세요." };
            setMessages(prev => [...prev, errorMessage]);
        } finally {
            setIsLoading(false);
        }
    };
    
    const examplePrompts = [
        "레이달리오의 사계절 포트폴리오 전략에 따라 내 자산 분배를 분석해줘.",
        "보유 종목 중 원자재 관련 주식이 있어?",
        "가장 수익률이 높은 자산은 뭐야?",
        "내 포트폴리오의 전반적인 위험도를 평가해줘."
    ];
    
    const handleExampleClick = (prompt: string) => {
        setInput(prompt);
        inputRef.current?.focus();
    };

    const handleClearHistory = () => {
        if (window.confirm('대화 기록을 정말 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) {
            setMessages([]);
            localStorage.removeItem(ASSISTANT_HISTORY_KEY);
        }
    };

    const markdownComponents = {
        table: ({node, ...props}: any) => <table className="table-auto w-full my-4 text-sm border-collapse border border-gray-600" {...props} />,
        thead: ({node, ...props}: any) => <thead className="bg-gray-700/50" {...props} />,
        th: ({node, ...props}: any) => <th className="border border-gray-600 px-3 py-2 text-left font-semibold text-gray-200" {...props} />,
        td: ({node, ...props}: any) => <td className="border border-gray-600 px-3 py-2" {...props} />,
        p: ({node, ...props}: any) => <p className="mb-2 last:mb-0" {...props} />,
        ul: ({node, ...props}: any) => <ul className="list-disc list-inside mb-2 pl-4" {...props} />,
        ol: ({node, ...props}: any) => <ol className="list-decimal list-inside mb-2 pl-4" {...props} />,
        li: ({node, ...props}: any) => <li className="mb-1" {...props} />,
        h3: ({node, ...props}: any) => <h3 className="text-lg font-bold mt-4 mb-2 text-primary-light" {...props} />,
        strong: ({node, ...props}: any) => <strong className="font-bold text-white" {...props} />,
        code: ({node, inline, ...props}: any) => inline
          ? <code className="bg-gray-900 text-yellow-300 px-1.5 py-1 rounded text-sm font-mono" {...props} />
          : <pre className="bg-gray-900 p-3 rounded-md overflow-x-auto my-2 text-sm"><code className="font-mono" {...props} /></pre>
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center z-50" onClick={onClose}>
            <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
                <header className="flex justify-between items-center p-4 border-b border-gray-700">
                    <div className="flex items-center gap-3">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-primary" viewBox="0 0 24 24" fill="currentColor">
                           <path d="M14 12c0 .552-.448 1-1 1s-1-.448-1-1 .448-1 1-1 1 .448 1 1zm-1-3.5c-2.481 0-4.5 2.019-4.5 4.5s2.019 4.5 4.5 4.5 4.5-2.019 4.5-4.5-2.019-4.5-4.5-4.5zm0-3.5c-4.411 0-8 3.589-8 8s3.589 8 8 8 8-3.589 8-8-3.589-8-8-8zm-5.5 8c0-3.033 2.468-5.5 5.5-5.5s5.5 2.467 5.5 5.5-2.468 5.5-5.5 5.5-5.5-2.467-5.5-5.5zm11.5 0c0 .828-.672 1.5-1.5 1.5s-1.5-.672-1.5-1.5.672-1.5 1.5-1.5 1.5.672 1.5 1.5z"/>
                        </svg>
                        <h2 className="text-xl font-bold text-white">포트폴리오 어시스턴트</h2>
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={handleClearHistory} title="대화 기록 초기화" className="text-gray-400 hover:text-white transition p-2">
                           <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                        </button>
                        <button onClick={onClose} title="닫기" className="text-gray-400 hover:text-white transition p-2">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                </header>
                <main className="flex-1 p-4 overflow-y-auto space-y-4">
                    {messages.length === 0 && !isLoading ? (
                        <div className="text-center p-8">
                             <h3 className="text-lg font-semibold text-white mb-4">무엇을 도와드릴까요?</h3>
                             <p className="text-gray-400 mb-6">포트폴리오에 대해 궁금한 점을 질문해보세요.</p>
                             <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-left">
                                {examplePrompts.map(prompt => (
                                    <button 
                                        key={prompt}
                                        onClick={() => handleExampleClick(prompt)}
                                        className="bg-gray-700 hover:bg-gray-600 text-gray-300 p-3 rounded-lg text-sm transition text-left"
                                    >
                                        {prompt}
                                    </button>
                                ))}
                             </div>
                        </div>
                    ) : (
                        messages.map((msg, index) => (
                            <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-xl lg:max-w-2xl px-4 py-3 rounded-lg ${msg.role === 'user' ? 'bg-primary text-white' : 'bg-gray-700 text-gray-200'}`}>
                                     {msg.role === 'model' ? (
                                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                                            {msg.content}
                                        </ReactMarkdown>
                                    ) : (
                                        <p className="whitespace-pre-wrap">{msg.content}</p>
                                    )}
                                </div>
                            </div>
                        ))
                    )}
                     {isLoading && (
                        <div className="flex justify-start">
                            <div className="bg-gray-700 text-gray-200 px-4 py-3 rounded-lg">
                                <div className="flex items-center space-x-2">
                                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-pulse [animation-delay:-0.3s]"></span>
                                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-pulse [animation-delay:-0.15s]"></span>
                                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-pulse"></span>
                                </div>
                            </div>
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </main>
                <footer className="p-4 border-t border-gray-700">
                    <div className="flex items-center bg-gray-700 rounded-lg">
                        <input
                            ref={inputRef}
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                            placeholder="포트폴리오에 대해 질문하세요..."
                            className="w-full bg-transparent p-3 text-white placeholder-gray-400 focus:outline-none"
                            disabled={isLoading}
                        />
                        <button onClick={handleSend} disabled={isLoading || !input.trim()} className="p-3 text-gray-400 hover:text-white disabled:text-gray-600 disabled:cursor-not-allowed transition">
                           <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" transform="rotate(90 12 12)" />
                            </svg>
                        </button>
                    </div>
                </footer>
            </div>
        </div>
    );
};

export default PortfolioAssistant;