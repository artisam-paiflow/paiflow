-- Add CANCEL to EventKind enum for cancel event classification
ALTER TYPE "EventKind" ADD VALUE IF NOT EXISTS 'CANCEL';