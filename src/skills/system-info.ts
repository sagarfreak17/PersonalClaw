/**
 * Deep System Info Skill — Comprehensive system intelligence.
 *
 * Goes far beyond basic sysinfo: hardware, software, security, storage, updates, drivers, events.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { Skill, SkillMeta } from '../types/skill.js';

const execAsync = promisify(exec);

export const systemInfoSkill: Skill = {
  name: 'system_info',
  description: `Deep system intelligence and diagnostics.
Actions:
- "overview": Full system summary (OS, CPU, RAM, disk, uptime, user).
- "hardware": Detailed hardware info (CPU model, cores, RAM slots, GPU, motherboard).
- "storage": Disk drives, partitions, space usage, health.
- "software": Installed programs list (optional "filter" to search by name).
- "updates": Recent Windows updates and pending updates.
- "drivers": List device drivers (optional "filter" for problem drivers).
- "events": Recent Windows Event Log entries. Optional "log" param: "System", "Application", "Security". Optional "level" param: "Error", "Warning".
- "security": Security status — antivirus, firewall, UAC, BitLocker.
- "battery": Battery status and health (laptops only).
- "environment": Environment variables (optional "filter" for specific var).
- "uptime": System uptime and boot time.
- "users": User accounts and login sessions.`,
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['overview', 'hardware', 'storage', 'software', 'updates', 'drivers', 'events', 'security', 'battery', 'environment', 'uptime', 'users'],
        description: 'The system info category to query.',
      },
      filter: {
        type: 'string',
        description: 'Optional filter/search term.',
      },
      log: {
        type: 'string',
        description: 'Event log name for "events" action (System, Application, Security).',
      },
      level: {
        type: 'string',
        description: 'Event level filter (Error, Warning, Information).',
      },
    },
    required: ['action'],
  },
  run: async ({ action, filter, log, level }: {
    action: string;
    filter?: string;
    log?: string;
    level?: string;
  }, _meta: SkillMeta) => {
    try {
      let command: string;

      switch (action) {
        case 'overview':
          command = `
$os = Get-CimInstance Win32_OperatingSystem;
$cpu = Get-CimInstance Win32_Processor;
$cs = Get-CimInstance Win32_ComputerSystem;
$uptime = (Get-Date) - $os.LastBootUpTime;
Write-Output "COMPUTER: $($cs.Name)";
Write-Output "OS: $($os.Caption) $($os.Version) Build $($os.BuildNumber)";
Write-Output "CPU: $($cpu.Name) ($($cpu.NumberOfCores) cores, $($cpu.NumberOfLogicalProcessors) threads)";
Write-Output "RAM: $([math]::Round($cs.TotalPhysicalMemory/1GB,1)) GB total, $([math]::Round(($os.TotalVisibleMemorySize - $os.FreePhysicalMemory)/1MB,1)) GB used";
Write-Output "UPTIME: $($uptime.Days)d $($uptime.Hours)h $($uptime.Minutes)m";
Write-Output "USER: $($env:USERNAME)@$($env:USERDOMAIN)";
Write-Output "ARCH: $($os.OSArchitecture)";
Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object { Write-Output "DISK $($_.DeviceID) $([math]::Round($_.FreeSpace/1GB,1))GB free / $([math]::Round($_.Size/1GB,1))GB total" }`;
          break;

        case 'hardware':
          command = `
Write-Output "=== CPU ===";
Get-CimInstance Win32_Processor | Format-List Name, Manufacturer, MaxClockSpeed, NumberOfCores, NumberOfLogicalProcessors, L2CacheSize, L3CacheSize | Out-String;
Write-Output "=== MEMORY ===";
Get-CimInstance Win32_PhysicalMemory | Select-Object BankLabel, Capacity, Speed, Manufacturer, MemoryType | ForEach-Object { Write-Output "$($_.BankLabel): $([math]::Round($_.Capacity/1GB,1))GB @ $($_.Speed)MHz ($($_.Manufacturer))" };
Write-Output "";
Write-Output "=== GPU ===";
Get-CimInstance Win32_VideoController | Format-List Name, DriverVersion, AdapterRAM, CurrentRefreshRate | Out-String;
Write-Output "=== MOTHERBOARD ===";
Get-CimInstance Win32_BaseBoard | Format-List Manufacturer, Product, SerialNumber | Out-String;
Write-Output "=== BIOS ===";
Get-CimInstance Win32_BIOS | Format-List Manufacturer, Name, Version, ReleaseDate | Out-String`;
          break;

        case 'storage':
          command = `
Write-Output "=== LOGICAL DRIVES ===";
Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | Select-Object DeviceID, VolumeName, FileSystem, @{N='Size(GB)';E={[math]::Round($_.Size/1GB,1)}}, @{N='Free(GB)';E={[math]::Round($_.FreeSpace/1GB,1)}}, @{N='Used%';E={[math]::Round(($_.Size-$_.FreeSpace)/$_.Size*100,1)}} | Format-Table -AutoSize | Out-String;
Write-Output "=== PHYSICAL DISKS ===";
Get-PhysicalDisk | Select-Object FriendlyName, MediaType, @{N='Size(GB)';E={[math]::Round($_.Size/1GB,1)}}, HealthStatus, OperationalStatus | Format-Table -AutoSize | Out-String`;
          break;

        case 'software':
          if (filter) {
            command = `Get-ItemProperty HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*, HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\* -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like "*${filter}*" } | Select-Object DisplayName, DisplayVersion, Publisher, InstallDate | Sort-Object DisplayName | Format-Table -AutoSize -Wrap | Out-String`;
          } else {
            command = `Get-ItemProperty HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*, HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\* -ErrorAction SilentlyContinue | Where-Object DisplayName | Select-Object DisplayName, DisplayVersion, Publisher | Sort-Object DisplayName | Format-Table -AutoSize -Wrap | Out-String`;
          }
          break;

        case 'updates':
          command = `
Write-Output "=== RECENT UPDATES ===";
Get-HotFix | Sort-Object InstalledOn -Descending | Select-Object -First 15 HotFixID, Description, InstalledOn | Format-Table -AutoSize | Out-String`;
          break;

        case 'drivers':
          if (filter) {
            command = `Get-CimInstance Win32_PnPSignedDriver | Where-Object { $_.DeviceName -like "*${filter}*" -or $_.DriverProviderName -like "*${filter}*" } | Select-Object DeviceName, DriverVersion, DriverProviderName, IsSigned | Format-Table -AutoSize -Wrap | Out-String`;
          } else {
            command = `
Write-Output "=== PROBLEM DRIVERS ===";
Get-CimInstance Win32_PnPEntity | Where-Object { $_.Status -ne 'OK' -and $_.Status } | Select-Object Name, Status, DeviceID | Format-Table -AutoSize -Wrap | Out-String;
Write-Output "=== ALL SIGNED DRIVERS (first 30) ===";
Get-CimInstance Win32_PnPSignedDriver | Where-Object DeviceName | Select-Object -First 30 DeviceName, DriverVersion, IsSigned | Format-Table -AutoSize -Wrap | Out-String`;
          }
          break;

        case 'events':
          const logName = log || 'System';
          const levelFilter = level ? `-Level ${level}` : '';
          const maxEvents = 20;
          command = `Get-WinEvent -LogName "${logName}" -MaxEvents ${maxEvents} ${levelFilter} -ErrorAction SilentlyContinue | Select-Object TimeCreated, LevelDisplayName, Id, @{N='Message';E={$_.Message.Substring(0, [Math]::Min(150, $_.Message.Length))}} | Format-Table -AutoSize -Wrap | Out-String`;
          break;

        case 'security':
          command = `
Write-Output "=== FIREWALL ===";
Get-NetFirewallProfile | Select-Object Name, Enabled, DefaultInboundAction, DefaultOutboundAction | Format-Table -AutoSize | Out-String;
Write-Output "=== ANTIVIRUS ===";
Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct -ErrorAction SilentlyContinue | Select-Object displayName, productState | Format-Table -AutoSize | Out-String;
Write-Output "=== UAC ===";
$uac = Get-ItemProperty "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System" -ErrorAction SilentlyContinue;
Write-Output "UAC Enabled: $($uac.EnableLUA -eq 1)";
Write-Output "Consent Prompt: $($uac.ConsentPromptBehaviorAdmin)";
Write-Output "";
Write-Output "=== BITLOCKER ===";
Get-BitLockerVolume -ErrorAction SilentlyContinue | Select-Object MountPoint, VolumeStatus, ProtectionStatus | Format-Table -AutoSize | Out-String`;
          break;

        case 'battery':
          command = `
$battery = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue;
if ($battery) {
  Write-Output "STATUS: $($battery.Status)";
  Write-Output "CHARGE: $($battery.EstimatedChargeRemaining)%";
  Write-Output "CHARGING: $($battery.BatteryStatus)";
  Write-Output "RUNTIME: $($battery.EstimatedRunTime) minutes";
  Write-Output "DESIGN CAPACITY: $($battery.DesignCapacity) mWh";
  powercfg /batteryreport /output "$env:TEMP\\battery.html" 2>$null;
  Write-Output "Full battery report saved to $env:TEMP\\battery.html";
} else {
  Write-Output "No battery detected (desktop system).";
}`;
          break;

        case 'environment':
          if (filter) {
            command = `Get-ChildItem Env: | Where-Object { $_.Name -like "*${filter}*" } | Format-Table Name, Value -AutoSize -Wrap | Out-String`;
          } else {
            command = `Get-ChildItem Env: | Sort-Object Name | Format-Table Name, @{N='Value';E={if($_.Value.Length -gt 80){$_.Value.Substring(0,80)+'...'}else{$_.Value}}} -AutoSize | Out-String`;
          }
          break;

        case 'uptime':
          command = `
$os = Get-CimInstance Win32_OperatingSystem;
$uptime = (Get-Date) - $os.LastBootUpTime;
Write-Output "BOOT TIME: $($os.LastBootUpTime)";
Write-Output "UPTIME: $($uptime.Days) days, $($uptime.Hours) hours, $($uptime.Minutes) minutes";
Write-Output "CURRENT TIME: $(Get-Date)";
Write-Output "TIMEZONE: $((Get-TimeZone).DisplayName)"`;
          break;

        case 'users':
          command = `
Write-Output "=== CURRENT USER ===";
Write-Output "$env:USERNAME@$env:USERDOMAIN";
Write-Output "";
Write-Output "=== LOCAL ACCOUNTS ===";
Get-LocalUser | Select-Object Name, Enabled, LastLogon, PasswordRequired | Format-Table -AutoSize | Out-String;
Write-Output "=== ACTIVE SESSIONS ===";
query user 2>$null | Out-String`;
          break;

        default:
          return { success: false, error: `Unknown action: ${action}` };
      }

      const { stdout, stderr } = await execAsync(
        `powershell -Command "${command.replace(/"/g, '`"')}"`,
        { timeout: 20000 }
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
