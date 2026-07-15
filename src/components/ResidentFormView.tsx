import React, { useState, useEffect, useRef } from 'react';
import { databaseService } from '../lib/databaseService';
import { Collection, Submission } from '../types';
import { 
  ClipboardList, 
  Calendar, 
  FileText, 
  UploadCloud, 
  AlertTriangle, 
  CheckCircle, 
  Clock, 
  Lock, 
  File, 
  X, 
  Plus, 
  RefreshCw,
  LogOut
} from 'lucide-react';

interface ResidentFormViewProps {
  resident: { id: string; name: string; category: string };
  onLogout: () => void;
}

export const ResidentFormView: React.FC<ResidentFormViewProps> = ({ resident, onLogout }) => {
  const [collection, setCollection] = useState<Collection | null>(null);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [successMessage, setSuccessMessage] = useState<string>('');

  // Form states
  const [currentRotation, setCurrentRotation] = useState<string>('');
  const [nextRotation, setNextRotation] = useState<string>('');
  const [takingLeave, setTakingLeave] = useState<boolean>(false);
  const [leaveType, setLeaveType] = useState<string>('Annual Leave');
  const [leaveStart, setLeaveStart] = useState<string>('');
  const [leaveEnd, setLeaveEnd] = useState<string>('');
  const [leaveApplied, setLeaveApplied] = useState<boolean>(false);
  const [uploadedUrls, setUploadedUrls] = useState<string[]>([]);
  const [notes, setNotes] = useState<string>('');

  // Uploading states
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadError, setUploadError] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState<boolean>(false);

  // Time remaining states
  const [timeRemaining, setTimeRemaining] = useState<string>('');
  const [isPastDeadline, setIsPastDeadline] = useState<boolean>(false);

  useEffect(() => {
    async function fetchCollectionAndSubmission() {
      setIsLoading(true);
      try {
        // 1. Get settings to identify current collection
        const settings = await databaseService.getSettings();
        
        if (!settings.current_collection_id) {
          setCollection(null);
          setIsLoading(false);
          return;
        }

        // 2. Fetch all collections to find details of the active one
        const collectionsList = await databaseService.getCollections();
        const activeColl = collectionsList.find(c => c.id === settings.current_collection_id);
        
        if (!activeColl) {
          setCollection(null);
          setIsLoading(false);
          return;
        }

        setCollection(activeColl);

        // 3. Fetch submission if it exists
        const subData = await databaseService.getSubmissionForWorkforceAndCollection(
          resident.id,
          activeColl.id
        );

        if (subData) {
          setSubmission(subData);
          setCurrentRotation(subData.current_rotation);
          setNextRotation(subData.next_rotation);
          setTakingLeave(subData.taking_leave);
          if (subData.leave_type) setLeaveType(subData.leave_type);
          if (subData.leave_start) setLeaveStart(subData.leave_start);
          if (subData.leave_end) setLeaveEnd(subData.leave_end);
          if (subData.leave_applied !== null) setLeaveApplied(subData.leave_applied);
          if (subData.leave_document_urls) setUploadedUrls(subData.leave_document_urls);
          if (subData.notes) setNotes(subData.notes);
        }
      } catch (err) {
        console.warn('Error fetching resident form details:', err);
        setErrorMessage('Failed to load roster collection details.');
      } finally {
        setIsLoading(false);
      }
    }

    fetchCollectionAndSubmission();
  }, [resident.id]);

  // Handle countdown calculation
  useEffect(() => {
    if (!collection) return;

    const timer = setInterval(() => {
      const now = new Date().getTime();
      const deadlineTime = new Date(collection.deadline).getTime();
      const diff = deadlineTime - now;

      if (diff <= 0 || collection.status === 'closed') {
        setIsPastDeadline(true);
        setTimeRemaining('Submission Deadline Closed');
        clearInterval(timer);
      } else {
        setIsPastDeadline(false);
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        
        if (days > 0) {
          setTimeRemaining(`${days}d ${hours}h ${mins}m remaining`);
        } else if (hours > 0) {
          setTimeRemaining(`${hours}h ${mins}m remaining`);
        } else {
          setTimeRemaining(`${mins}m remaining`);
        }
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [collection]);

  const isFormReadOnly = isPastDeadline || (collection && collection.status === 'closed');

  // Drag and drop event handlers
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isFormReadOnly) return;
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (isFormReadOnly) return;

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFilesUpload(e.dataTransfer.files);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFilesUpload(e.target.files);
    }
  };

  const handleFilesUpload = async (files: FileList) => {
    setUploadError('');
    const validTypes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
    const uploadedCount = uploadedUrls.length;

    if (uploadedCount >= 3) {
      setUploadError('Maximum of 3 leave documents can be uploaded.');
      return;
    }

    const fileList = Array.from(files);
    const spaceLeft = 3 - uploadedCount;
    const filesToUpload = fileList.slice(0, spaceLeft);

    if (fileList.length > spaceLeft) {
      setUploadError(`You can only upload up to 3 documents. Selected files truncated.`);
    }

    setIsUploading(true);
    try {
      const urls: string[] = [];
      for (const file of filesToUpload) {
        if (!validTypes.includes(file.type)) {
          setUploadError(`Unsupported file format: "${file.name}". Only PDF, JPG, JPEG, and PNG are allowed.`);
          continue;
        }
        
        // 5MB limit
        if (file.size > 5 * 1024 * 1024) {
          setUploadError(`File "${file.name}" is too large. Max size is 5MB.`);
          continue;
        }

        const url = await databaseService.uploadLeaveDocument(resident.id, file);
        urls.push(url);
      }
      setUploadedUrls(prev => [...prev, ...urls]);
    } catch (err) {
      console.warn(err);
      setUploadError('Failed to upload file to storage.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemoveFile = (indexToRemove: number) => {
    if (isFormReadOnly) return;
    setUploadedUrls(prev => prev.filter((_, idx) => idx !== indexToRemove));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');

    if (isFormReadOnly) {
      setErrorMessage('The collection deadline has passed or is closed. Submissions are locked.');
      return;
    }

    // Validation
    if (!currentRotation.trim()) {
      setErrorMessage('Please specify your Current Rotation / Unit.');
      return;
    }

    if (!nextRotation.trim()) {
      setErrorMessage('Please specify your Expected Rotation / Unit Next Month.');
      return;
    }

    if (takingLeave) {
      if (!leaveStart) {
        setErrorMessage('Please specify your Leave Start Date.');
        return;
      }
      if (!leaveEnd) {
        setErrorMessage('Please specify your Leave End Date.');
        return;
      }
      if (new Date(leaveStart) > new Date(leaveEnd)) {
        setErrorMessage('Leave Start Date cannot be after the Leave End Date.');
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const submissionPayload = {
        collection_id: collection!.id,
        workforce_id: resident.id,
        current_rotation: currentRotation.trim(),
        next_rotation: nextRotation.trim(),
        taking_leave: takingLeave,
        leave_type: takingLeave ? leaveType : null,
        leave_start: takingLeave ? leaveStart : null,
        leave_end: takingLeave ? leaveEnd : null,
        leave_applied: takingLeave ? leaveApplied : null,
        leave_document_urls: takingLeave ? uploadedUrls : [],
        notes: notes.trim() ? notes.trim() : null,
      };

      const result = await databaseService.submitRoster(submissionPayload);
      setSubmission(result);
      setSuccessMessage('Roster information submitted successfully!');
      
      // Scroll to top to see success message
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      console.warn(err);
      setErrorMessage('Failed to submit roster information. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto my-12 p-8 text-center bg-white border border-slate-200 rounded-2xl shadow-sm">
        <RefreshCw size={32} className="text-slate-500 animate-spin mx-auto mb-3" />
        <p className="text-sm font-medium text-slate-600">Retrieving collection settings...</p>
      </div>
    );
  }

  if (!collection) {
    return (
      <div className="max-w-2xl mx-auto my-12 p-8 text-center bg-white border border-slate-200 rounded-2xl shadow-sm">
        <AlertTriangle size={40} className="text-amber-500 mx-auto mb-3" />
        <h3 className="text-lg font-bold text-slate-900">No Active Collection Found</h3>
        <p className="text-sm text-slate-500 mt-2">
          The Department of Family Medicine does not have an active monthly roster collection open right now.
          Please check back when your Chief Resident opens the collection.
        </p>
        <button
          onClick={onLogout}
          className="mt-6 inline-flex items-center space-x-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-xs font-bold cursor-pointer shadow-sm"
        >
          <LogOut size={13} />
          <span>Exit Portal</span>
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto my-8 px-4">
      {/* Status Warning & Clock Banner */}
      <div className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Resident Header */}
        <div className="md:col-span-2 bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Logged In</span>
            <h2 className="text-lg font-extrabold text-slate-900 tracking-tight">{resident.name}</h2>
            <p className="text-xs text-slate-500">{resident.category} &bull; Family Medicine</p>
          </div>
          {submission ? (
            <div className="bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs px-3 py-1.5 rounded-full font-semibold flex items-center space-x-1 shrink-0">
              <CheckCircle size={13} />
              <span>Roster Submitted</span>
            </div>
          ) : (
            <div className="bg-amber-50 text-amber-800 border border-amber-200 text-xs px-3 py-1.5 rounded-full font-semibold flex items-center space-x-1 shrink-0 animate-pulse">
              <Clock size={13} />
              <span>Pending Submission</span>
            </div>
          )}
        </div>

        {/* Collection Deadline Block */}
        <div className={`rounded-2xl p-5 border shadow-sm flex flex-col justify-center ${
          isFormReadOnly 
            ? 'bg-rose-50 text-rose-900 border-rose-200' 
            : 'bg-gradient-to-br from-blue-600 to-indigo-800 text-white border-blue-700'
        }`}>
          <span className={`text-[9px] uppercase tracking-wider font-bold ${
            isFormReadOnly ? 'text-rose-700' : 'text-blue-200'
          }`}>
            {collection.title}
          </span>
          <div className="flex items-center space-x-1.5 mt-0.5">
            {isFormReadOnly ? <Lock size={15} className="text-rose-600 shrink-0" /> : <Clock size={15} className="text-emerald-400 shrink-0" />}
            <span className="text-sm font-bold tracking-tight truncate">{timeRemaining}</span>
          </div>
          <p className={`text-[10px] mt-1 ${isFormReadOnly ? 'text-rose-600' : 'text-slate-400'}`}>
            Deadline: {new Date(collection.deadline).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            })}
          </p>
        </div>
      </div>

      {/* Form Card */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="bg-slate-50 border-b border-slate-100 px-6 py-4 flex justify-between items-center">
          <div className="flex items-center space-x-2">
            <ClipboardList className="text-slate-500" size={18} />
            <h3 className="font-bold text-slate-800 text-sm md:text-base">Monthly Workforce Form</h3>
          </div>
          {isFormReadOnly && (
            <div className="bg-rose-100 text-rose-800 px-2.5 py-1 rounded-lg text-xs font-bold flex items-center space-x-1">
              <Lock size={11} />
              <span>Locked (Read Only)</span>
            </div>
          )}
        </div>

        {isFormReadOnly && (
          <div className="bg-rose-50/50 border-b border-rose-100 px-6 py-3 text-xs text-rose-800 flex items-start space-x-2">
            <AlertTriangle size={15} className="shrink-0 mt-0.5" />
            <span>
              The submission deadline has been reached. This form is now locked. You can view your current submission details but cannot modify them. Please contact the Chief Resident to request adjustments.
            </span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="p-6 md:p-8 space-y-6">
          {errorMessage && (
            <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-xl p-4 flex items-start space-x-2.5 text-xs sm:text-sm">
              <AlertTriangle size={18} className="shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {successMessage && (
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl p-4 flex items-start space-x-2.5 text-xs sm:text-sm">
              <CheckCircle size={18} className="shrink-0 mt-0.5" />
              <span>{successMessage}</span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Current Rotation */}
            <div className="space-y-1.5">
              <label htmlFor="current-rotation" className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                Current Rotation / Unit
              </label>
              <input
                id="current-rotation"
                type="text"
                disabled={isFormReadOnly}
                value={currentRotation}
                onChange={(e) => setCurrentRotation(e.target.value)}
                placeholder="e.g. Geriatrics, Trauma, Outpatient"
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition disabled:opacity-60"
              />
              <p className="text-[10px] text-slate-500">The unit or ward where you are deployed this current month.</p>
            </div>

            {/* Next Rotation */}
            <div className="space-y-1.5">
              <label htmlFor="next-rotation" className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                Expected Rotation / Unit Next Month
              </label>
              <input
                id="next-rotation"
                type="text"
                disabled={isFormReadOnly}
                value={nextRotation}
                onChange={(e) => setNextRotation(e.target.value)}
                placeholder="e.g. Community Health, Pediatrics"
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition disabled:opacity-60"
              />
              <p className="text-[10px] text-slate-500">Your upcoming deployment posting as assigned in the forecast roster.</p>
            </div>
          </div>

          {/* Taking Leave */}
          <div className="space-y-2 pt-2 border-t border-slate-100">
            <div className="flex items-center justify-between">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Are you taking leave next month?
                </label>
                <p className="text-[10px] text-slate-500">Select Yes if you have scheduled, applied, or approved leave.</p>
              </div>
              <div className="flex items-center bg-slate-100 p-1 rounded-xl">
                <button
                  type="button"
                  disabled={isFormReadOnly}
                  onClick={() => setTakingLeave(false)}
                  className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                    !takingLeave
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-500 hover:text-slate-800'
                  } disabled:opacity-60`}
                >
                  No
                </button>
                <button
                  type="button"
                  disabled={isFormReadOnly}
                  onClick={() => setTakingLeave(true)}
                  className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                    takingLeave
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-500 hover:text-slate-800'
                  } disabled:opacity-60`}
                >
                  Yes
                </button>
              </div>
            </div>

            {/* Leave Details Box */}
            {takingLeave && (
              <div className="mt-4 bg-slate-50 rounded-2xl p-5 border border-slate-200 space-y-5 animate-slideDown">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Leave Type */}
                  <div className="space-y-1.5">
                    <label htmlFor="leave-type" className="block text-xs font-semibold text-slate-700">
                      Leave Type
                    </label>
                    <select
                      id="leave-type"
                      disabled={isFormReadOnly}
                      value={leaveType}
                      onChange={(e) => setLeaveType(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition cursor-pointer"
                    >
                      <option>Annual Leave</option>
                      <option>Maternity Leave</option>
                      <option>Paternity Leave</option>
                      <option>Sick Leave</option>
                      <option>Compassionate Leave</option>
                      <option>Study Leave</option>
                      <option>Other</option>
                    </select>
                  </div>

                  {/* Have Applied */}
                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-slate-700">
                      Have you applied to the department?
                    </label>
                    <div className="flex items-center space-x-4 h-9">
                      <label className="inline-flex items-center space-x-1.5 text-xs font-medium text-slate-700 cursor-pointer">
                        <input
                          type="radio"
                          disabled={isFormReadOnly}
                          checked={leaveApplied === true}
                          onChange={() => setLeaveApplied(true)}
                          className="text-blue-600 focus:ring-blue-100 rounded-full h-4 w-4 border-slate-300"
                        />
                        <span>Yes</span>
                      </label>
                      <label className="inline-flex items-center space-x-1.5 text-xs font-medium text-slate-700 cursor-pointer">
                        <input
                          type="radio"
                          disabled={isFormReadOnly}
                          checked={leaveApplied === false}
                          onChange={() => setLeaveApplied(false)}
                          className="text-blue-600 focus:ring-blue-100 rounded-full h-4 w-4 border-slate-300"
                        />
                        <span>No</span>
                      </label>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Leave Start */}
                  <div className="space-y-1.5">
                    <label htmlFor="leave-start" className="block text-xs font-semibold text-slate-700">
                      Leave Start Date
                    </label>
                    <div className="relative">
                      <input
                        id="leave-start"
                        type="date"
                        disabled={isFormReadOnly}
                        value={leaveStart}
                        onChange={(e) => setLeaveStart(e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition"
                      />
                    </div>
                  </div>

                  {/* Leave End */}
                  <div className="space-y-1.5">
                    <label htmlFor="leave-end" className="block text-xs font-semibold text-slate-700">
                      Leave End Date
                    </label>
                    <div className="relative">
                      <input
                        id="leave-end"
                        type="date"
                        disabled={isFormReadOnly}
                        value={leaveEnd}
                        onChange={(e) => setLeaveEnd(e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition"
                      />
                    </div>
                  </div>
                </div>

                {/* File Upload Zone */}
                <div className="space-y-2 pt-2 border-t border-slate-200">
                  <label className="block text-xs font-semibold text-slate-700">
                    Upload Leave Documents <span className="text-slate-400 font-normal">(Max 3 files, PDF, JPG, PNG)</span>
                  </label>

                  {!isFormReadOnly && (
                    <div
                      onDragEnter={handleDrag}
                      onDragOver={handleDrag}
                      onDragLeave={handleDrag}
                      onDrop={handleDrop}
                      onClick={() => fileInputRef.current?.click()}
                      className={`border-2 border-dashed rounded-xl p-5 text-center transition cursor-pointer flex flex-col items-center justify-center space-y-1.5 ${
                        dragActive 
                          ? 'border-slate-900 bg-slate-100' 
                          : 'border-slate-300 hover:border-slate-400 bg-white'
                      }`}
                    >
                      <UploadCloud size={28} className="text-slate-400" />
                      <div>
                        <p className="text-xs font-semibold text-slate-800">
                          Drag and drop files here, or <span className="text-slate-900 underline">browse</span>
                        </p>
                        <p className="text-[10px] text-slate-400 mt-0.5">PDF, JPEG, JPG, PNG up to 5MB</p>
                      </div>
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        accept=".pdf,image/jpeg,image/jpg,image/png"
                        onChange={handleFileChange}
                        className="hidden"
                      />
                    </div>
                  )}

                  {uploadError && (
                    <div className="text-rose-600 text-[10px] sm:text-xs font-medium flex items-center space-x-1 pt-1">
                      <AlertTriangle size={12} />
                      <span>{uploadError}</span>
                    </div>
                  )}

                  {isUploading && (
                    <div className="flex items-center space-x-1.5 text-slate-600 text-xs font-medium pt-1">
                      <RefreshCw size={12} className="animate-spin text-slate-400" />
                      <span>Uploading document, please wait...</span>
                    </div>
                  )}

                  {/* Uploaded File List */}
                  {uploadedUrls.length > 0 && (
                    <div className="space-y-1.5 mt-2">
                      <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                        Attached Documents ({uploadedUrls.length}/3)
                      </div>
                      <div className="grid grid-cols-1 gap-2">
                        {uploadedUrls.map((url, index) => {
                          // Extract file name or show a numbered label
                          const isMock = url.startsWith('blob:') || url.startsWith('https://example.com');
                          const displayName = isMock 
                            ? `Leave_Document_${index + 1}`
                            : decodeURIComponent(url.split('/').pop() || `document_${index + 1}`).split('_').slice(1).join('_') || `Document ${index + 1}`;
                          
                          return (
                            <div key={index} className="flex items-center justify-between bg-white px-3 py-2 rounded-lg border border-slate-200">
                              <a
                                href={url}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center space-x-2 text-xs font-medium text-slate-800 hover:text-slate-950 truncate hover:underline"
                              >
                                <File size={14} className="text-slate-400 shrink-0" />
                                <span className="truncate max-w-[200px] sm:max-w-md">{displayName}</span>
                              </a>
                              {!isFormReadOnly && (
                                <button
                                  type="button"
                                  onClick={() => handleRemoveFile(index)}
                                  className="text-slate-400 hover:text-rose-600 p-1 hover:bg-slate-50 rounded-lg transition shrink-0 cursor-pointer"
                                  title="Remove attachment"
                                >
                                  <X size={14} />
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Notes */}
          <div className="space-y-1.5 pt-2 border-t border-slate-100">
            <label htmlFor="notes" className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
              Additional Notes / Requests
            </label>
            <textarea
              id="notes"
              rows={3}
              disabled={isFormReadOnly}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Requesting specific weekend shifts off, or additional details about rotation swapping..."
              className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition disabled:opacity-60"
            />
          </div>

          {/* Buttons */}
          <div className="flex items-center justify-between pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={onLogout}
              className="flex items-center space-x-1.5 px-4 py-2.5 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-xs sm:text-sm font-bold transition cursor-pointer"
            >
              <LogOut size={14} />
              <span>Exit Portal</span>
            </button>

            {!isFormReadOnly && (
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex items-center space-x-1.5 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:text-slate-500 text-white rounded-xl text-xs sm:text-sm font-bold shadow-sm transition transform active:scale-[0.98] cursor-pointer"
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw size={14} className="animate-spin" />
                    <span>Saving...</span>
                  </>
                ) : (
                  <span>{submission ? 'Update Submission' : 'Submit Roster Info'}</span>
                )}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};
