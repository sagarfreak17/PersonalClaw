/**
 * Process Manager Skill — View, manage, and control running processes.
 *
 * List processes, kill unresponsive apps, start services, monitor resource hogs.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { Skill, SkillMeta } from '../types/skill.js';

const execAsync = promisify(exec);

export const processManagerSkill: Skill = {
  name: 'manage_processes',
  description: `View, monitor, and manage running Windows processes and services.
Actions:
- "list": List running processes sorted by CPU or memory usage. Optional "sort" param: "cpu" or "memory" (default: memory). Optional "count" param (default: 20).
- "search": Find processes by name (requires "name").
- "kill": Kill a process by name or PID (requires "target"). Use with caution.
- "details": Get detailed info about a process (requires "target" name or PID).
- "services": List Windows services. Optional "filter": "running", "stopped", or a service name search.
- "start_service": Start a Windows service (requires "target" service name).
- "stop_service": Stop a Windows service (requires "target" service name).
- "restart_service": Restart a Windows service (requires "target" service name).
- "startup": List programs that run at Windows startup.
- "resource_hogs": Show top resource-consuming processes.`,
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'search', 'kill', 'details', 'services', 'start_service', 'stop_service', 'restart_service', 'startup', 'resource_hogs'],
        description: 'The process management action.',
      },
      target: {
        type: 'string',
        description: 'Process name, PID, or service name.',
      },
      sort: {
        type: 'string',
        enum: ['cpu', 'memory'],
        description: 'Sort order for list action.',
      },
      filter: {
        type: 'string',
        description: 'Filter for services (running/stopped/name).',
      },
      count: {
        type: 'number',
        description: 'Number of results to return (default: 20).',
      },
    },
    required: ['action'],
  },
  run: async ({ action, target, sort, filter, count }: {
    action: string;
    target?: string;
    sort?: string;
    filter?: string;
    count?: number;
  }, _meta: SkillMeta) => {
    try {
      let command: string;
      const n = count || 20;

      switch (action) {
        case 'list':
          if (sort === 'cpu') {
            command = `Get-Process | Sort-Object CPU -Descending | Select-Object -First ${n} Id, ProcessName, @{N='CPU(s)';E={[math]::Round($_.CPU,1)}}, @{N='Mem(MB)';E={[math]::Round($_.WorkingSet64/1MB,1)}}, Responding | Format-Table -AutoSize | Out-String`;
          } else {
            command = `Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First ${n} Id, ProcessName, @{N='CPU(s)';E={[math]::Round($_.CPU,1)}}, @{N='Mem(MB)';E={[math]::Round($_.WorkingSet64/1MB,1)}}, Responding | Format-Table -AutoSize | Out-String`;
          }
          break;

        case 'search':
          if (!target) return { success: false, error: 'Process name is required for search.' };
          command = `Get-Process -Name "*${target}*" -ErrorAction SilentlyContinue | Select-Object Id, ProcessName, @{N='CPU(s)';E={[math]::Round($_.CPU,1)}}, @{N='Mem(MB)';E={[math]::Round($_.WorkingSet64/1MB,1)}}, Path | Format-Table -AutoSize | Out-String`;
          break;

        case 'kill':
          if (!target) return { success: false, error: 'Process name or PID is required for kill.' };
          // Check if target is a number (PID) or name
          if (/^\d+$/.test(target)) {
            command = `Stop-Process -Id ${target} -Force -ErrorAction Stop; Write-Output "Process ${target} terminated."`;
          } else {
            command = `Stop-Process -Name "${target}" -Force -ErrorAction Stop; Write-Output "Process(es) '${target}' terminated."`;
          }
          break;

        case 'details':
          if (!target) return { success: false, error: 'Process name or PID required.' };
          if (/^\d+$/.test(target)) {
            command = `Get-Process -Id ${target} -ErrorAction Stop | Format-List Id, ProcessName, CPU, @{N='Mem(MB)';E={[math]::Round($_.WorkingSet64/1MB,1)}}, StartTime, Path, Responding, MainWindowTitle, PriorityClass | Out-String`;
          } else {
            command = `Get-Process -Name "*${target}*" -ErrorAction SilentlyContinue | Select-Object -First 5 | Format-List Id, ProcessName, CPU, @{N='Mem(MB)';E={[math]::Round($_.WorkingSet64/1MB,1)}}, StartTime, Path, Responding | Out-String`;
          }
          break;

        case 'services':
          if (filter === 'running') {
            command = `Get-Service | Where-Object Status -eq Running | Select-Object -First ${n} Name, DisplayName, Status, StartType | Format-Table -AutoSize | Out-String`;
          } else if (filter === 'stopped') {
            command = `Get-Service | Where-Object Status -eq Stopped | Select-Object -First ${n} Name, DisplayName, Status, StartType | Format-Table -AutoSize | Out-String`;
          } else if (filter) {
            command = `Get-Service -Name "*${filter}*" -ErrorAction SilentlyContinue | Select-Object Name, DisplayName, Status, StartType | Format-Table -AutoSize | Out-String; Get-Service -DisplayName "*${filter}*" -ErrorAction SilentlyContinue | Select-Object Name, DisplayName, Status, StartType | Format-Table -AutoSize | Out-String`;
          } else {
            command = `Get-Service | Group-Object Status | Select-Object Name, Count | Format-Table -AutoSize | Out-String; Get-Service | Where-Object Status -eq Running | Select-Object -First ${n} Name, DisplayName | Format-Table -AutoSize | Out-String`;
          }
          break;

        case 'start_service':
          if (!target) return { success: false, error: 'Service name required.' };
          command = `Start-Service -Name "${target}" -ErrorAction Stop; Get-Service -Name "${target}" | Format-List Name, DisplayName, Status | Out-String`;
          break;

        case 'stop_service':
          if (!target) return { success: false, error: 'Service name required.' };
          command = `Stop-Service -Name "${target}" -Force -ErrorAction Stop; Get-Service -Name "${target}" | Format-List Name, DisplayName, Status | Out-String`;
          break;

        case 'restart_service':
          if (!target) return { success: false, error: 'Service name required.' };
          command = `Restart-Service -Name "${target}" -Force -ErrorAction Stop; Get-Service -Name "${target}" | Format-List Name, DisplayName, Status | Out-String`;
          break;

        case 'startup':
          command = `Get-CimInstance Win32_StartupCommand | Select-Object Name, Command, Location, User | Format-Table -AutoSize -Wrap | Out-String`;
          break;

        case 'resource_hogs':
          command = `Write-Output "=== TOP CPU CONSUMERS ==="; Get-Process | Sort-Object CPU -Descending | Select-Object -First 10 ProcessName, Id, @{N='CPU(s)';E={[math]::Round($_.CPU,1)}}, @{N='Mem(MB)';E={[math]::Round($_.WorkingSet64/1MB,1)}} | Format-Table -AutoSize | Out-String; Write-Output "=== TOP MEMORY CONSUMERS ==="; Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 10 ProcessName, Id, @{N='Mem(MB)';E={[math]::Round($_.WorkingSet64/1MB,1)}}, @{N='CPU(s)';E={[math]::Round($_.CPU,1)}} | Format-Table -AutoSize | Out-String`;
          break;

        default:
          return { success: false, error: `Unknown action: ${action}` };
      }

      const { stdout, stderr } = await execAsync(
        `powershell -Command "${command.replace(/"/g, '`"')}"`,
        { timeout: 15000 }
      );

      return {
        success: true,
        action,
        output: (stdout || '').trim(),
        warnings: (stderr || '').trim() || undefined,
      };
    } catch (error: any) {
      return {
        success: false,
        action,
        error: error.message,
        stdout: error.stdout?.trim(),
        stderr: error.stderr?.trim(),
      };
    }
  },
};
