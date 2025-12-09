import React, { useState, useEffect } from 'react';
import dayjs from 'dayjs';
import './DateRangeFilter.css';

/**
 * Reusable Date Range Filter Component
 * Supports pre-defined ranges and custom date selection
 */
const DateRangeFilter = ({ 
  startDate, 
  endDate, 
  onChange, 
  showCompare = false,
  onCompareChange = null,
  storageKey = null 
}) => {
  const [activePreset, setActivePreset] = useState('');
  const [customStart, setCustomStart] = useState(startDate || dayjs().startOf('month').format('YYYY-MM-DD'));
  const [customEnd, setCustomEnd] = useState(endDate || dayjs().format('YYYY-MM-DD'));
  const [showCustom, setShowCustom] = useState(false);
  const [compareEnabled, setCompareEnabled] = useState(false);

  // Load saved preferences from localStorage
  useEffect(() => {
    if (storageKey) {
      const saved = localStorage.getItem(`dateFilter_${storageKey}`);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (parsed.preset) {
            setActivePreset(parsed.preset);
            applyPreset(parsed.preset, false);
          } else if (parsed.custom) {
            setCustomStart(parsed.custom.start);
            setCustomEnd(parsed.custom.end);
            setShowCustom(true);
            onChange(parsed.custom.start, parsed.custom.end);
          }
          if (parsed.compare !== undefined) {
            setCompareEnabled(parsed.compare);
            if (onCompareChange) onCompareChange(parsed.compare);
          }
        } catch (e) {
          console.error('Failed to load saved date filter:', e);
        }
      }
    }
  }, [storageKey]);

  // Save preferences to localStorage
  const savePreferences = (preset, custom, compare) => {
    if (storageKey) {
      localStorage.setItem(`dateFilter_${storageKey}`, JSON.stringify({
        preset,
        custom,
        compare
      }));
    }
  };

  const applyPreset = (preset, triggerChange = true) => {
    let start, end;
    const today = dayjs();
    
    switch (preset) {
      case 'today':
        start = today.format('YYYY-MM-DD');
        end = today.format('YYYY-MM-DD');
        break;
      case 'yesterday':
        start = today.subtract(1, 'day').format('YYYY-MM-DD');
        end = today.subtract(1, 'day').format('YYYY-MM-DD');
        break;
      case 'thisWeek':
        start = today.startOf('week').format('YYYY-MM-DD');
        end = today.format('YYYY-MM-DD');
        break;
      case 'lastWeek':
        start = today.subtract(1, 'week').startOf('week').format('YYYY-MM-DD');
        end = today.subtract(1, 'week').endOf('week').format('YYYY-MM-DD');
        break;
      case 'thisMonth':
        start = today.startOf('month').format('YYYY-MM-DD');
        end = today.format('YYYY-MM-DD');
        break;
      case 'lastMonth':
        start = today.subtract(1, 'month').startOf('month').format('YYYY-MM-DD');
        end = today.subtract(1, 'month').endOf('month').format('YYYY-MM-DD');
        break;
      case 'thisYear':
        start = today.startOf('year').format('YYYY-MM-DD');
        end = today.format('YYYY-MM-DD');
        break;
      default:
        return;
    }

    setActivePreset(preset);
    setShowCustom(false);
    setCustomStart(start);
    setCustomEnd(end);
    
    if (triggerChange) {
      onChange(start, end);
      savePreferences(preset, null, compareEnabled);
    }
  };

  const handleCustomApply = () => {
    if (customStart && customEnd && dayjs(customStart).isBefore(dayjs(customEnd).add(1, 'day'))) {
      setActivePreset('');
      onChange(customStart, customEnd);
      savePreferences('', { start: customStart, end: customEnd }, compareEnabled);
    }
  };

  const handleCompareToggle = (enabled) => {
    setCompareEnabled(enabled);
    if (onCompareChange) onCompareChange(enabled);
    savePreferences(activePreset, showCustom ? { start: customStart, end: customEnd } : null, enabled);
  };

  const presets = [
    { key: 'today', label: 'Today' },
    { key: 'yesterday', label: 'Yesterday' },
    { key: 'thisWeek', label: 'This Week' },
    { key: 'lastWeek', label: 'Last Week' },
    { key: 'thisMonth', label: 'This Month' },
    { key: 'lastMonth', label: 'Last Month' },
    { key: 'thisYear', label: 'This Year' },
    { key: 'custom', label: 'Custom Range' }
  ];

  return (
    <div className="date-range-filter">
      <div className="preset-buttons">
        {presets.map(preset => (
          <button
            key={preset.key}
            className={`preset-btn ${activePreset === preset.key ? 'active' : ''} ${preset.key === 'custom' && showCustom ? 'active' : ''}`}
            onClick={() => {
              if (preset.key === 'custom') {
                setShowCustom(!showCustom);
                setActivePreset('');
              } else {
                applyPreset(preset.key);
              }
            }}
            aria-label={`Select ${preset.label}`}
          >
            {preset.label}
          </button>
        ))}
      </div>

      {showCustom && (
        <div className="custom-range">
          <div className="date-inputs">
            <div className="date-input-group">
              <label htmlFor="custom-start">Start Date</label>
              <input
                id="custom-start"
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                max={customEnd || dayjs().format('YYYY-MM-DD')}
                aria-label="Start date"
              />
            </div>
            <div className="date-input-group">
              <label htmlFor="custom-end">End Date</label>
              <input
                id="custom-end"
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                min={customStart}
                max={dayjs().format('YYYY-MM-DD')}
                aria-label="End date"
              />
            </div>
            <button
              className="apply-btn"
              onClick={handleCustomApply}
              disabled={!customStart || !customEnd || dayjs(customStart).isAfter(dayjs(customEnd))}
              aria-label="Apply custom date range"
            >
              Apply
            </button>
          </div>
        </div>
      )}

      {showCompare && (
        <div className="compare-toggle">
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={compareEnabled}
              onChange={(e) => handleCompareToggle(e.target.checked)}
              aria-label="Compare with previous period"
            />
            <span>Compare with previous period</span>
          </label>
        </div>
      )}

      {(activePreset || showCustom) && (
        <div className="active-range">
          <span className="range-label">Active Range:</span>
          <span className="range-dates">
            {dayjs(activePreset ? (activePreset === 'today' ? dayjs() : dayjs(customStart)) : customStart).format('MMM D, YYYY')}
            {' → '}
            {dayjs(activePreset ? (activePreset === 'today' ? dayjs() : dayjs(customEnd)) : customEnd).format('MMM D, YYYY')}
          </span>
        </div>
      )}
    </div>
  );
};

export default DateRangeFilter;

