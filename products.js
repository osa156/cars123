const express = require('express');
const router = express.Router();
const cars = require('../models/cars');

// Get all cars with optional filtering
router.get('/', (req, res) => {
  try {
    let filteredCars = [...cars];
    
    // Filter by brand
    if (req.query.brand) {
      const brands = req.query.brand.split(',').map(b => b.toLowerCase());
      filteredCars = filteredCars.filter(car => brands.includes(car.brand.toLowerCase()));
    }
    
    // Filter by year range
    if (req.query.minYear) {
      filteredCars = filteredCars.filter(car => car.year >= parseInt(req.query.minYear));
    }
    if (req.query.maxYear) {
      filteredCars = filteredCars.filter(car => car.year <= parseInt(req.query.maxYear));
    }
    
    // Filter by price range
    if (req.query.minPrice) {
      filteredCars = filteredCars.filter(car => car.price >= parseFloat(req.query.minPrice));
    }
    if (req.query.maxPrice) {
      filteredCars = filteredCars.filter(car => car.price <= parseFloat(req.query.maxPrice));
    }
    
    // Search
    if (req.query.search) {
      const search = req.query.search.toLowerCase();
      filteredCars = filteredCars.filter(car => 
        car.model.toLowerCase().includes(search) ||
        car.brand.toLowerCase().includes(search) ||
        car.description.toLowerCase().includes(search)
      );
    }
    
    // Sort
    if (req.query.sort) {
      switch(req.query.sort) {
        case 'price-asc':
          filteredCars.sort((a, b) => a.price - b.price);
          break;
        case 'price-desc':
          filteredCars.sort((a, b) => b.price - a.price);
          break;
        case 'year-desc':
          filteredCars.sort((a, b) => b.year - a.year);
          break;
        case 'year-asc':
          filteredCars.sort((a, b) => a.year - b.year);
          break;
        case 'power-desc':
          filteredCars.sort((a, b) => b.horsepower - a.horsepower);
          break;
      }
    }
    
    // Pagination
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || filteredCars.length;
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedCars = filteredCars.slice(startIndex, endIndex);
    
    res.json({
      success: true,
      total: filteredCars.length,
      page: page,
      limit: limit,
      totalPages: Math.ceil(filteredCars.length / limit),
      data: paginatedCars
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get single car by ID
router.get('/:id', (req, res) => {
  try {
    const car = cars.find(c => c.id === req.params.id);
    if (!car) {
      return res.status(404).json({ success: false, error: 'Car not found' });
    }
    res.json({ success: true, data: car });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get all brands
router.get('/meta/brands', (req, res) => {
  try {
    const brands = [...new Set(cars.map(car => car.brand))];
    res.json({ success: true, data: brands });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get price range
router.get('/meta/prices', (req, res) => {
  try {
    const prices = cars.map(car => car.price);
    res.json({
      success: true,
      data: {
        min: Math.min(...prices),
        max: Math.max(...prices)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get featured cars
router.get('/featured/list', (req, res) => {
  try {
    // Return the most powerful cars as featured
    const featured = [...cars].sort((a, b) => b.horsepower - a.horsepower).slice(0, 6);
    res.json({ success: true, data: featured });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
