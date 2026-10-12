---
title: Tienda Demo
project: demo-shop
locale: es
summary: Todo lo necesario para que varias sesiones construyan la tienda demo por frentes paralelos.
pillars:
  - { title: Pagos idempotentes, text: Todo cobro lleva clave de idempotencia. }
  - { title: Verificable, text: Cada tarea tiene un "hecho cuando" ejecutable. }
start_prompt: /waypoint:work backend
---

Introducción breve del documento.

## Alcance

La versión 0.1 cubre pedidos, carrito y pago con Stripe.

### Fuera de alcance

Multi-divisa y PayPal.

## Arquitectura

Backend en Node y frontend web.

## Riesgos

La migración de reembolsos no tiene rollback.
