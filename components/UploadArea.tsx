import React, { useRef, useState } from 'react';
import { UploadCloud, Loader2, Upload, ShieldCheck, Search, FileText } from 'lucide-react';

interface UploadAreaProps {
  onScan: (files: FileList) => Promise<void>;
  isScanning: boolean;
}

const UploadArea: React.FC<UploadAreaProps> = ({ onScan, isScanning }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        onScan(e.dataTransfer.files);
    }
  };

  const handleClick = () => {
    inputRef.current?.click();
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onScan(e.target.files);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-full w-full max-w-3xl mx-auto px-6 animate-fade-in">
      {/* Greeting Section */}
      <div className="mb-10 text-center space-y-6">
        <div className="w-16 h-16 bg-claude-accent rounded-2xl mx-auto flex items-center justify-center shadow-md shadow-orange-900/10 mb-6">
             <UploadCloud className="text-white w-9 h-9" strokeWidth={1.5} />
        </div>
        <h2 className="font-serif text-4xl text-gray-900 tracking-tight">
          Good morning, Developer
        </h2>
        <p className="text-claude-subtext text-lg max-w-lg mx-auto leading-relaxed font-sans">
          I can help you audit your local AI agent capabilities. Select a repository to generate a governance report.
        </p>
      </div>

      {/* Main Input Card (Mimics Claude's Prompt Area) */}
      <div 
        className={`w-full max-w-2xl transition-all duration-300 ease-out transform ${isDragging ? 'scale-[1.02]' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div 
          onClick={handleClick}
          className={`
            bg-white border rounded-xl p-5 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] cursor-pointer relative group min-h-[120px] flex flex-col justify-between
            ${isDragging ? 'border-claude-accent ring-2 ring-claude-accent/20' : 'border-[#E5E4E0] hover:border-[#D1D1D1]'}
            transition-all duration-200
          `}
        >
          <div className="flex items-start gap-4">
            <div className={`
                w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-colors
                ${isScanning ? 'bg-claude-bg' : 'bg-[#F4F3F0] group-hover:bg-[#EAE9E4]'}
            `}>
                {isScanning ? (
                    <Loader2 className="animate-spin text-claude-subtext" size={20} />
                ) : (
                    <Upload className="text-claude-subtext group-hover:text-gray-600" size={20} />
                )}
            </div>
            
            <div className="flex-1 pt-2">
               <span className="text-gray-500 text-lg font-medium block mb-1">
                 {isScanning ? 'Analyzing filesystem...' : 'Select a folder to scan...'}
               </span>
               <span className="text-xs text-gray-400 font-sans">
                 Supports nested directories and scans skill folders by `SKILL.md` / `skill.md`.
               </span>
            </div>
          </div>
          
          <div className="flex justify-end mt-2">
             <div className="bg-[#F4F3F0] px-2 py-1 rounded text-[10px] font-mono text-gray-400 border border-transparent group-hover:border-[#E5E4E0]">
                Click or Drop Folder
             </div>
          </div>

          {/* Hidden Input with directory attributes */}
          <input
            type="file"
            ref={inputRef}
            className="hidden"
            onChange={handleInputChange}
            {...({ webkitdirectory: "", directory: "", multiple: true } as any)}
          />
        </div>
      </div>

      {/* Capability Pills (Mimics "Suggested Prompts") */}
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <div className="flex items-center gap-2 px-3 py-1.5 bg-white border border-claude-border rounded-full text-xs text-gray-600 shadow-sm cursor-default select-none">
            <ShieldCheck size={12} className="text-emerald-600" />
            <span>Identify Security Risks</span>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 bg-white border border-claude-border rounded-full text-xs text-gray-600 shadow-sm cursor-default select-none">
            <Search size={12} className="text-blue-600" />
            <span>Categorize Capabilities</span>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 bg-white border border-claude-border rounded-full text-xs text-gray-600 shadow-sm cursor-default select-none">
            <FileText size={12} className="text-claude-accent" />
            <span>Audit System Prompts</span>
        </div>
      </div>
    </div>
  );
};

export default UploadArea;
