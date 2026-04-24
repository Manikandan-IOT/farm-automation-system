# 🌾 Farm Automation System

**⚠️ Status: Sample/Prototype — Currently being developed into a commercial product**

An end-to-end IoT-based farm irrigation and fertigation automation system.
Conceptualized and designed by me, developed with AI assistance (Claude by Anthropic).

---

## 🎯 What it does

- Automates irrigation and fertigation scheduling for farms
- ESP32 microcontroller controls motors and valves in the field
- Web dashboard accessible from anywhere — real-time monitoring
- Works OFFLINE — ESP32 stores schedules locally, runs independently
- Multi-user system — Admin, Team, and Customer roles

---

## 🏗️ System Architecture

Browser/Mobile
     ↕ HTTPS / WebSocket
Node.js Backend + SQLite
     ↕ MQTT (Mosquitto broker)
ESP32 in field → GPIO → Relays → Motors + Valves

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Firmware | C language, ESP-IDF v5.x, FreeRTOS |
| Microcontroller | ESP32-WROOM-32 |
| Backend | Node.js, Express.js, SQLite |
| Frontend | HTML, CSS, Vanilla JavaScript |
| Communication | MQTT (Mosquitto), WebSocket |
| Auth | JWT + bcrypt |
| Storage (ESP32) | NVS flash, SNTP time sync |

---

## ✨ Features

- ✅ Pin configuration from web → ESP32 GPIO setup
- ✅ Irrigation scheduling (time, duration, days of week)
- ✅ Fertigation scheduling with fertilizer type and dose
- ✅ Manual valve/motor control from dashboard
- ✅ Live sensor data (temperature, humidity, soil moisture)
- ✅ Real-time notifications (irrigation started/ended)
- ✅ Offline operation — works without internet
- ✅ Role-based access — Admin / Team / Customer
- ✅ Multi-farm, multi-device support

---

## 📡 MQTT Topic Structure

Server → ESP32:
- farm/{device_uid}/pin  → PIN:2:valve:1:output
- farm/{device_uid}/cmd  → IRR:1:1:1:0600:030:1010100
- farm/{device_uid}/cmd  → VALVE:ON:1

ESP32 → Server:
- farm/{device_uid}/status  → online/offline
- farm/{device_uid}/sensors → temperature, humidity, soil
- farm/{device_uid}/notify  → irrigation events

---

## 🚀 Development Note

> This project was conceptualized by me as a solution for real farm automation needs.
> Development was done with AI assistance (Claude by Anthropic) for code generation,
> while all system design, architecture decisions, requirements, and testing were mine.
> This is currently a working prototype — being developed into a commercial product.

---

## 📂 Repository Structure

farm-automation-system/
├── backend/          Node.js API server
├── frontend/         Web dashboard (HTML/CSS/JS)
└── README.md

farm-automation-firmware/
├── main/
│   ├── main.c        Main firmware logic
│   ├── farm_config.h Device configuration
│   ├── farm_nvs.h    NVS storage header
│   └── farm_nvs.c    NVS storage implementation
└── README.md

---
Manikandan A
IoT Developer | Tamil Nadu, India
LinkedIn: www.linkedin.com/in/manikandan-a-65a260274
