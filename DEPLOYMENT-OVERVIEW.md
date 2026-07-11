# MatSci YAMZ — Deployment Overview

This document summarizes what is required to operate MatSci YAMZ in production, the main hosting choices, and the decisions the project owner should expect to make. Detailed implementation instructions are provided separately in `DEPLOYMENT-TECHNICAL.md`.

## 1. What the production service requires

MatSci YAMZ consists of a web application and several supporting services:

- **Web application:** the Next.js application that serves the site and its API
- **PostgreSQL database:** stores user records, terms, definitions, comments, votes, tags, and AI interaction history
- **Ollama service:** runs the language model used to generate and revise definitions; the application currently requests `gemma3`
- **Reverse proxy and HTTPS:** Nginx, or an institutional load balancer, accepts secure public traffic and forwards it to the application
- **Google OAuth:** provides user sign-in and requires a registered Google OAuth application

### High-level architecture

```text
                         Users
                           │
                    HTTPS (public)
                           │
                 ┌─────────▼─────────┐
                 │ Reverse proxy /   │
                 │ load balancer     │
                 └─────────┬─────────┘
                           │
                 ┌─────────▼─────────┐
                 │ MatSci YAMZ web   │
                 │ application       │
                 └──────┬───────┬────┘
                        │       │
              ┌─────────▼──┐ ┌──▼──────────────┐
              │ PostgreSQL │ │ Ollama / model  │
              │ database   │ │ service         │
              └────────────┘ └─────────────────┘

              Database and Ollama may be local
              to the VM or provided remotely.
```

Only the HTTPS endpoint should be publicly available. The application, database, and Ollama interfaces should remain private.

## 2. Expected server size

The appropriate VM size depends mainly on whether Ollama runs on the same machine.

| Configuration | Suggested starting point |
|---|---|
| Application only; remote database and remote Ollama | 2 vCPUs, 2–4 GB RAM, 20 GB SSD |
| Application plus local PostgreSQL | 2–4 vCPUs, 4–8 GB RAM, 30–50 GB SSD |
| Application, PostgreSQL, and Ollama on one VM | 4+ vCPUs, 8–16+ GB RAM, 50+ GB SSD |

Ubuntu 24.04 LTS or another institutionally supported Linux distribution is appropriate. A larger Ollama model may require substantially more memory or a GPU, so the all-in-one configuration should not be treated as fixed if the model changes.

## 3. Hosting choices

### Database

**Preferred:** use Drexel's managed PostgreSQL service if it can provide:

- a dedicated database and application account
- encrypted network connectivity from the application VM
- supported PostgreSQL compatibility
- scheduled backups and a documented restore process
- acceptable availability, capacity, and support arrangements

This option reduces the amount of infrastructure the project team must patch, monitor, and back up. The application can use a remote PostgreSQL database through configuration; no application redesign is required.

**Alternative:** run PostgreSQL on the application VM, preferably with persistent storage and automated off-host backups. This gives the project more control but also makes it responsible for upgrades, backup testing, recovery, storage monitoring, and database availability.

### Ollama and the language model

**Local Ollama** is a reasonable starting point for low usage and the current model if the VM has enough memory. It is simple, but AI processing competes with the website for CPU and RAM.

**Remote Ollama** is preferable if Drexel already operates a suitable model server, if usage increases, or if a larger model or GPU is required. The connection must remain on a trusted private network and should be governed by access controls and an agreed service owner.

If the model changes from `gemma3`, the model must first be installed on the Ollama host. The current application also requires a small configuration/code change and restart because the model name is presently fixed in the source code.

### Application packaging

The application can be operated in either of two ways:

1. **Docker Compose:** packages the application and, if desired, local PostgreSQL and Ollama into repeatable containers. This generally simplifies rebuilding, moving, and updating the service.
2. **Direct VM installation with systemd:** runs Node.js directly on the VM and uses the operating system's service manager. This may be preferable if it matches Drexel's established operations standards.

Docker improves consistency and maintainability, but it does not by itself provide high availability. Docker Compose on one VM still has a single-machine failure point. The best choice is the one the team responsible for production support can operate reliably.

## 4. Recommended starting architecture

For the lowest ongoing maintenance burden:

- run the **web application and reverse proxy** on a supported Linux VM
- package the application with **Docker Compose**, unless Drexel operations prefers systemd
- use **Drexel's managed PostgreSQL** if its service and recovery commitments are suitable
- use an **existing remote Ollama service** if one is supported; otherwise run Ollama locally for the initial `gemma3` workload
- expose only **HTTPS** publicly
- keep the application, database, and Ollama connections on private interfaces or trusted networks

This separates the durable data and resource-intensive AI workload from the public web application where institutional services are available. It also allows either dependency to be changed later through configuration with limited application impact.

## 5. What the project owner should expect

Before production launch, the project needs decisions or assigned owners for the following:

| Area | Decision or commitment needed |
|---|---|
| Hosting | VM provider, operating system standard, capacity, and administrator |
| Domain and TLS | DNS ownership, public hostname, and certificate renewal responsibility |
| Database | Drexel-managed or project-managed; backup retention and recovery expectations |
| AI service | Local or remote Ollama; approved model, capacity, and service owner |
| Authentication | Google OAuth project owner and authorized callback domain |
| Secrets | Approved storage and rotation process for database, OAuth, and session secrets |
| Operations | Responsibility for deployments, updates, monitoring, logs, and incident response |
| Availability | Acceptable downtime and whether a single-VM deployment is sufficient |
| Data governance | Retention, privacy, and institutional security requirements for user and AI interaction data |

## 6. Availability and maintenance expectations

A basic single-VM deployment is suitable for an initial or modest production service, but the VM remains a single point of failure. Automatic process restarts can recover from an application crash, but not from a VM, storage, or network outage.

At minimum, production operation should include:

- automated PostgreSQL backups and periodic restore tests
- operating system and dependency security updates
- application and service health monitoring
- alerts for downtime, low disk space, and backup failures
- log retention and rotation
- documented deployment, rollback, and recovery procedures
- restricted administrative and network access

If the project requires higher availability, the design should expand beyond one VM to include redundant application instances, a managed or highly available database, and a load balancer. That is a separate level of infrastructure and operational commitment from the recommended starting deployment.

## 7. Network summary

- **Public:** HTTPS on port 443; port 80 may be used only to redirect to HTTPS
- **Private application listener:** typically port 3000
- **Private PostgreSQL connection:** typically port 5432
- **Private Ollama connection:** typically port 11434
- **Administrative access:** SSH should be restricted to approved networks and administrators

## 8. Launch checklist

- [ ] Confirm VM hosting and production support owner
- [ ] Choose the PostgreSQL location and confirm backup/restore responsibilities
- [ ] Choose the Ollama location and approved model
- [ ] Confirm whether Docker Compose or systemd will be supported
- [ ] Configure DNS, HTTPS certificates, and firewall rules
- [ ] Register and configure Google OAuth credentials
- [ ] Store production secrets using the approved method
- [ ] Apply database migrations and validate connectivity
- [ ] Configure monitoring, logs, backups, and alerts
- [ ] Document deployment, rollback, and service recovery
- [ ] Complete functional, security, and recovery testing before launch
