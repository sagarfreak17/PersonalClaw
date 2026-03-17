/**
 * Network Diagnostics Skill — Deep network troubleshooting from PersonalClaw.
 *
 * Ping, traceroute, DNS lookup, port scanning, and connection testing.
 * Essential for MSP/IT work.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { Skill, SkillMeta } from '../types/skill.js';

const execAsync = promisify(exec);

export const networkSkill: Skill = {
  name: 'network_diagnostics',
  description: `Network diagnostic tools for troubleshooting connectivity issues.
Actions:
- "ping": Ping a host (requires "target"). Returns latency and packet loss.
- "traceroute": Trace route to a host (requires "target"). Shows hop-by-hop path.
- "dns": DNS lookup (requires "target" domain). Resolves A, AAAA, MX, NS records.
- "port_check": Test if a specific port is open (requires "target" host, "port" number).
- "connections": Show active network connections (optional "filter" for state like ESTABLISHED).
- "interfaces": List all network interfaces with IP addresses.
- "speed_test": Quick bandwidth estimate using a small download test.
- "arp": Show ARP table (local network device discovery).
- "route": Show routing table.
- "whois": WHOIS lookup for a domain (requires "target").

Built for MSP/IT diagnostics. All commands run via PowerShell on Windows.`,
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['ping', 'traceroute', 'dns', 'port_check', 'connections', 'interfaces', 'arp', 'route', 'whois'],
        description: 'The diagnostic action to perform.',
      },
      target: {
        type: 'string',
        description: 'Target hostname, IP address, or domain.',
      },
      port: {
        type: 'number',
        description: 'Port number (for port_check action).',
      },
      filter: {
        type: 'string',
        description: 'Optional filter (e.g., "ESTABLISHED" for connections).',
      },
    },
    required: ['action'],
  },
  run: async ({ action, target, port, filter }: {
    action: string;
    target?: string;
    port?: number;
    filter?: string;
  }, _meta: SkillMeta) => {
    try {
      let command: string;

      switch (action) {
        case 'ping':
          if (!target) return { success: false, error: 'Target is required for ping.' };
          command = `Test-Connection -ComputerName "${target}" -Count 4 | Format-Table Address, Latency, Status -AutoSize | Out-String`;
          break;

        case 'traceroute':
          if (!target) return { success: false, error: 'Target is required for traceroute.' };
          command = `Test-NetConnection -ComputerName "${target}" -TraceRoute | Select-Object -ExpandProperty TraceRoute | ForEach-Object { $i=0 } { $i++; "$i  $_" } | Out-String; Test-NetConnection -ComputerName "${target}" | Format-List RemoteAddress, RemotePort, InterfaceAlias, TcpTestSucceeded | Out-String`;
          break;

        case 'dns':
          if (!target) return { success: false, error: 'Target is required for DNS lookup.' };
          command = `Resolve-DnsName "${target}" -Type A -ErrorAction SilentlyContinue | Format-Table Name, Type, TTL, IPAddress -AutoSize | Out-String; Resolve-DnsName "${target}" -Type MX -ErrorAction SilentlyContinue | Format-Table Name, Type, NameExchange, Preference -AutoSize | Out-String; Resolve-DnsName "${target}" -Type NS -ErrorAction SilentlyContinue | Format-Table Name, Type, NameHost -AutoSize | Out-String`;
          break;

        case 'port_check':
          if (!target) return { success: false, error: 'Target is required for port check.' };
          if (!port) return { success: false, error: 'Port number is required.' };
          command = `Test-NetConnection -ComputerName "${target}" -Port ${port} | Format-List ComputerName, RemoteAddress, RemotePort, TcpTestSucceeded, PingSucceeded | Out-String`;
          break;

        case 'connections':
          if (filter) {
            command = `Get-NetTCPConnection -State ${filter} -ErrorAction SilentlyContinue | Select-Object LocalAddress, LocalPort, RemoteAddress, RemotePort, State, OwningProcess | Sort-Object State | Format-Table -AutoSize | Out-String`;
          } else {
            command = `Get-NetTCPConnection | Group-Object State | Select-Object Name, Count | Sort-Object Count -Descending | Format-Table -AutoSize | Out-String; Get-NetTCPConnection -State Established | Select-Object -First 20 LocalAddress, LocalPort, RemoteAddress, RemotePort, OwningProcess | Format-Table -AutoSize | Out-String`;
          }
          break;

        case 'interfaces':
          command = `Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -ne '127.0.0.1' } | Select-Object InterfaceAlias, IPAddress, PrefixLength | Format-Table -AutoSize | Out-String; Get-NetAdapter | Where-Object Status -eq Up | Select-Object Name, InterfaceDescription, MacAddress, LinkSpeed | Format-Table -AutoSize | Out-String`;
          break;

        case 'arp':
          command = `Get-NetNeighbor -AddressFamily IPv4 | Where-Object { $_.State -ne 'Unreachable' } | Select-Object IPAddress, LinkLayerAddress, State, InterfaceAlias | Format-Table -AutoSize | Out-String`;
          break;

        case 'route':
          command = `Get-NetRoute -AddressFamily IPv4 | Where-Object { $_.DestinationPrefix -ne '255.255.255.255/32' -and $_.DestinationPrefix -ne '224.0.0.0/4' } | Select-Object DestinationPrefix, NextHop, RouteMetric, InterfaceAlias | Sort-Object RouteMetric | Format-Table -AutoSize | Out-String`;
          break;

        case 'whois':
          if (!target) return { success: false, error: 'Target domain is required for WHOIS.' };
          // Use nslookup as fallback since whois isn't always available
          command = `try { whois "${target}" 2>$null | Select-Object -First 30 | Out-String } catch { nslookup "${target}" 2>&1 | Out-String }`;
          break;

        default:
          return { success: false, error: `Unknown action: ${action}` };
      }

      const { stdout, stderr } = await execAsync(
        `powershell -Command "${command.replace(/"/g, '`"')}"`,
        { timeout: 30000 }
      );

      return {
        success: true,
        action,
        target: target || 'local',
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
