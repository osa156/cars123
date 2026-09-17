const express = require('express');
const router = express.Router();
const axios = require('axios');
const cars = require('../models/cars');

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_API_BASE = 'https://api.paystack.co';

// Initialize payment transaction
router.post('/initialize', async (req, res) => {
  try {
    const { email, amount, items, metadata = {} } = req.body;
    
    // Validate required fields
    if (!email || !amount || !items) {
      return res.status(400).json({
        success: false,
        error: 'Email, amount, and items are required'
      });
    }
    
    // Validate items exist and calculate total
    let calculatedTotal = 0;
    const validatedItems = [];
    
    for (const item of items) {
      const car = cars.find(c => c.id === item.id);
      if (!car) {
        return res.status(400).json({
          success: false,
          error: `Car with ID ${item.id} not found`
        });
      }
      if (car.stock < item.quantity) {
        return res.status(400).json({
          success: false,
          error: `Insufficient stock for ${car.brand} ${car.model}`
        });
      }
      calculatedTotal += car.price * item.quantity;
      validatedItems.push({
        ...car,
        quantity: item.quantity,
        lineTotal: car.price * item.quantity
      });
    }
    
    // Verify amount matches (allow small variance for fees)
    if (Math.abs(calculatedTotal - amount) > 100) {
      return res.status(400).json({
        success: false,
        error: 'Amount mismatch. Please refresh your cart.'
      });
    }
    
    // Convert to kobo/cents (Paystack expects amount in smallest currency unit)
    const amountInKobo = Math.round(amount * 100);
    
    // Create Paystack transaction
    const paystackResponse = await axios.post(
      `${PAYSTACK_API_BASE}/transaction/initialize`,
      {
        email: email,
        amount: amountInKobo,
        currency: 'NGN',
        callback_url: metadata.callback_url || `${req.protocol}://${req.get('host')}/payment/success`,
        metadata: {
          ...metadata,
          items: validatedItems.map(item => ({
            id: item.id,
            brand: item.brand,
            model: item.model,
            year: item.year,
            quantity: item.quantity,
            unitPrice: item.price,
            lineTotal: item.lineTotal
          })),
          totalAmount: calculatedTotal,
          custom_fields: [
            {
              display_name: "Items Purchased",
              variable_name: "items_count",
              value: validatedItems.length
            },
            {
              display_name: "Order Type",
              variable_name: "order_type",
              value: "Luxury Vehicle Purchase"
            }
          ]
        }
      },
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    if (paystackResponse.data.status) {
      res.json({
        success: true,
        data: {
          authorization_url: paystackResponse.data.data.authorization_url,
          access_code: paystackResponse.data.data.access_code,
          reference: paystackResponse.data.data.reference,
          amount: amount,
          items: validatedItems
        }
      });
    } else {
      res.status(400).json({
        success: false,
        error: paystackResponse.data.message || 'Failed to initialize payment'
      });
    }
    
  } catch (error) {
    console.error('Payment initialization error:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.response?.data?.message || 'Payment initialization failed'
    });
  }
});

// Verify payment transaction
router.get('/verify/:reference', async (req, res) => {
  try {
    const { reference } = req.params;
    
    if (!reference) {
      return res.status(400).json({
        success: false,
        error: 'Transaction reference is required'
      });
    }
    
    const paystackResponse = await axios.get(
      `${PAYSTACK_API_BASE}/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`
        }
      }
    );
    
    if (paystackResponse.data.status) {
      const transactionData = paystackResponse.data.data;
      
      // Update stock if payment is successful
      if (transactionData.status === 'success') {
        const items = transactionData.metadata?.items || [];
        for (const item of items) {
          const car = cars.find(c => c.id === item.id);
          if (car) {
            car.stock = Math.max(0, car.stock - item.quantity);
          }
        }
      }
      
      res.json({
        success: true,
        data: {
          status: transactionData.status,
          reference: transactionData.reference,
          amount: transactionData.amount / 100, // Convert back to main currency
          currency: transactionData.currency,
          customer: transactionData.customer,
          metadata: transactionData.metadata,
          paid_at: transactionData.paid_at,
          created_at: transactionData.created_at,
          channel: transactionData.channel,
          authorization: transactionData.authorization
        }
      });
    } else {
      res.status(400).json({
        success: false,
        error: paystackResponse.data.message || 'Failed to verify payment'
      });
    }
    
  } catch (error) {
    console.error('Payment verification error:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.response?.data?.message || 'Payment verification failed'
    });
  }
});

// Paystack webhook endpoint
router.post('/webhook', async (req, res) => {
  try {
    const hash = require('crypto')
      .createHmac('sha512', PAYSTACK_SECRET_KEY)
      .update(JSON.stringify(req.body))
      .digest('hex');
    
    if (hash !== req.headers['x-paystack-signature']) {
      return res.status(401).send('Invalid signature');
    }
    
    const event = req.body;
    
    // Handle successful charge
    if (event.event === 'charge.success') {
      const items = event.data.metadata?.items || [];
      for (const item of items) {
        const car = cars.find(c => c.id === item.id);
        if (car) {
          car.stock = Math.max(0, car.stock - item.quantity);
        }
      }
      console.log('Payment successful, stock updated:', event.data.reference);
    }
    
    res.status(200).send('Webhook received');
    
  } catch (error) {
    console.error('Webhook error:', error.message);
    res.status(500).send('Webhook processing failed');
  }
});

// Charge with Paystack public token (for inline payments)
router.post('/charge', async (req, res) => {
  try {
    const { email, amount, reference } = req.body;
    
    if (!email || !amount || !reference) {
      return res.status(400).json({
        success: false,
        error: 'Email, amount, and reference are required'
      });
    }
    
    const amountInKobo = Math.round(amount * 100);
    
    const paystackResponse = await axios.post(
      `${PAYSTACK_API_BASE}/transaction/charge_authorization`,
      {
        email,
        amount: amountInKobo,
        reference
      },
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    res.json({
      success: paystackResponse.data.status,
      data: paystackResponse.data.data
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.response?.data?.message || 'Charge failed'
    });
  }
});

module.exports = router;
